#!/usr/bin/env bash
# Disposable PostgreSQL 16 rehearsal for dormant Genesis watermark publication.
set -euo pipefail
transport=container
container=''
if [[ $# -eq 1 && $1 == --local ]]; then
  transport=local
elif [[ $# -eq 2 && $1 == --container && $2 =~ ^[a-zA-Z0-9_.-]+$ && $2 =~ (^|[-_])test($|[-_]) ]]; then
  container=$2
else
  echo 'Usage: rehearse-genesis-reconciliation.sh --container <postgres-16-test-container> | --local' >&2
  exit 2
fi
docker_cli=${DOCKER_CLI:-docker}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
db="genesis_q4_it_$(date -u +%Y%m%d%H%M%S)_${BASHPID}"
created=0
output=$(mktemp)
background_pid=''

admin_sql() {
  if [[ $transport == local ]]; then psql -X -v ON_ERROR_STOP=1 -d postgres "$@"; return; fi
  "$docker_cli" exec -i "$container" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres "$@"' sh "$@"
}
db_sql() {
  if [[ $transport == local ]]; then psql -X -v ON_ERROR_STOP=1 -d "$db" "$@"; return; fi
  "$docker_cli" exec -i "$container" sh -c \
    'db_name=$1; shift; exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db_name" "$@"' sh "$db" "$@"
}
cleanup() {
  status=$?
  trap - EXIT
  set +e
  if [[ -n $background_pid ]]; then wait "$background_pid"; fi
  rm -f -- "$output"
  if (( created )); then
    printf 'DROP DATABASE "%s" WITH (FORCE);\n' "$db" | admin_sql >/dev/null
    (( $? == 0 )) || status=1
    remaining=$(printf "SELECT count(*) FROM pg_database WHERE datname = '%s';\n" "$db" | admin_sql -At | tr -d '\r\n')
    [[ $remaining == 0 ]] || status=1
  fi
  if (( status == 0 )); then
    echo 'Genesis reconciliation rehearsal passed; temporary database removed.'
  else
    echo 'Genesis reconciliation rehearsal failed; check cleanup output.' >&2
  fi
  exit "$status"
}
trap cleanup EXIT

version=$(printf 'SHOW server_version_num;\n' | admin_sql -At | tr -d '\r\n')
if [[ $transport == container ]]; then
  [[ $version =~ ^16[0-9]{4}$ ]] || { echo 'Expected PostgreSQL 16 test container' >&2; exit 1; }
else
  [[ $version =~ ^[0-9]{6}$ && $version -ge 160000 ]] || { echo 'Expected local PostgreSQL 16 or newer' >&2; exit 1; }
fi
echo "Rehearsing with PostgreSQL server_version_num=$version in $db"
printf 'CREATE DATABASE "%s";\n' "$db" | admin_sql >/dev/null
created=1
for migration in 001_genesis_core.sql 002_genesis_swap_valuations.sql 003_genesis_reconciliation_watermark.sql; do
  db_sql < "$repo_root/db/migrations/$migration" >/dev/null
done
db_sql < "$repo_root/db/tests/genesis_reconciliation_watermark.sql" >/dev/null

cat <<'SQL' | db_sql >/dev/null
INSERT INTO genesis.campaigns (id, cluster) VALUES ('concurrency-test', 'devnet');
INSERT INTO genesis.indexer_cursors
    (campaign_id, program_id, decoder_version, next_slot, reconciliation_start_slot)
    VALUES ('concurrency-test', 'test-program', 'decoder-1', 20, 10);
INSERT INTO genesis.chain_events
    (campaign_id, cluster, signature, instruction_index, event_index, event_kind,
     slot, block_time, wallet, payload, event_sha256, decoder_version, verified_at)
    VALUES ('concurrency-test', 'devnet', 'event-12', 0, 0, 'swap', 12,
            to_timestamp(1700000000), 'test-wallet', '{}', repeat('a', 64), 'decoder-1', now()),
           ('concurrency-test', 'devnet', 'event-10', 0, 0, 'swap', 10,
            to_timestamp(1700000000), 'test-wallet', '{}', repeat('c', 64), 'decoder-1', now());
UPDATE genesis.indexer_cursors SET reconciled_through_slot = 11;
SQL

wait_for_locked_sleep() {
  local application=$1 sleeping
  for attempt in {1..100}; do
    sleeping=$(printf "SELECT count(*) FROM pg_stat_activity WHERE datname = '%s' AND application_name = '%s' AND wait_event = 'PgSleep';\n" "$db" "$application" | admin_sql -qAt | tr -d '\r\n')
    [[ $sleeping == 1 ]] && return 0
    sleep 0.1
  done
  echo 'Concurrent transaction never reached its synchronization point' >&2
  return 1
}

# Publication holds cursor first; conflict insertion must wait then invalidate.
db_sql -qAt -c "SET application_name = 'genesis-q4-publish-test'; BEGIN; SELECT next_slot FROM genesis.indexer_cursors FOR UPDATE; UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15; SELECT pg_sleep(5); COMMIT;" > "$output" &
background_pid=$!
wait_for_locked_sleep genesis-q4-publish-test
db_sql -q -c "INSERT INTO genesis.ingest_conflicts (existing_event_id, observed_event_sha256, observed_decoder_version) SELECT id, repeat('b',64), 'decoder-1' FROM genesis.chain_events WHERE signature = 'event-12';"
wait "$background_pid"
background_pid=''
watermark=$(printf 'SELECT reconciled_through_slot FROM genesis.indexer_cursors;\n' | db_sql -qAt | tr -d '\r\n')
[[ $watermark == 11 ]] || { echo 'Late conflict left publication trusted' >&2; exit 1; }

# Conflict holds cursor first; READ COMMITTED publication must see it after waiting.
db_sql -q -c "UPDATE genesis.ingest_conflicts SET resolution = 'source_error', resolved_at = now(); UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15;"
db_sql -qAt -c "SET application_name = 'genesis-q4-conflict-test'; BEGIN; INSERT INTO genesis.ingest_conflicts (existing_event_id, observed_event_sha256, observed_decoder_version) SELECT id, repeat('d',64), 'decoder-1' FROM genesis.chain_events WHERE signature = 'event-10'; SELECT pg_sleep(5); COMMIT;" > "$output" &
background_pid=$!
wait_for_locked_sleep genesis-q4-conflict-test
observed=$(db_sql -qAt -c "BEGIN ISOLATION LEVEL READ COMMITTED; SELECT COALESCE(reconciled_through_slot::text, 'unreconciled') FROM genesis.indexer_cursors FOR UPDATE; SELECT count(*) FROM genesis.ingest_conflicts WHERE resolution = 'open'; COMMIT;" | tr -d '\r')
wait "$background_pid"
background_pid=''
[[ $observed == $'unreconciled\n1' ]] || { echo 'Publication missed prior committed conflict' >&2; exit 1; }
