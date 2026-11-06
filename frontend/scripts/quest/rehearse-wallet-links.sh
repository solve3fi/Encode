#!/usr/bin/env bash
# Rehearse dormant Q3 wallet history on an explicitly named PostgreSQL 16 test container.
set -euo pipefail

if [[ $# -ne 2 || $1 != --container || ! $2 =~ ^[a-zA-Z0-9_.-]+$ || ! $2 =~ (^|[-_])test($|[-_]) ]]; then
  echo 'Usage: rehearse-wallet-links.sh --container <postgres-16-test-container>' >&2
  exit 2
fi

container=$2
docker_cli=${DOCKER_CLI:-docker}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
db="quest_q3_it_$(date -u +%Y%m%d%H%M%S)_${BASHPID}"
created=0
out1=$(mktemp)
out2=$(mktemp)

admin_sql() {
  "$docker_cli" exec -i "$container" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres "$@"' sh "$@"
}

db_sql() {
  "$docker_cli" exec -i "$container" sh -c \
    'db_name=$1; shift; exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$db_name" "$@"' sh "$db" "$@"
}

cleanup() {
  status=$?
  trap - EXIT
  set +e
  rm -f -- "$out1" "$out2"
  if (( created )); then
    printf 'DROP DATABASE "%s" WITH (FORCE);\n' "$db" | admin_sql >/dev/null
    (( $? == 0 )) || status=1
    remaining=$(printf "SELECT count(*) FROM pg_database WHERE datname = '%s';\n" "$db" | admin_sql -At | tr -d '\r\n')
    if [[ $remaining != 0 ]]; then
      echo "Expected no Q3 rehearsal database; catalog count: $remaining" >&2
      status=1
    fi
  fi
  if (( status == 0 )); then
    echo 'Wallet link rehearsal passed; temporary database removed.'
  else
    echo 'Wallet link rehearsal failed; check cleanup output above.' >&2
  fi
  exit "$status"
}
trap cleanup EXIT

version=$(printf 'SHOW server_version_num;\n' | admin_sql -At | tr -d '\r\n')
if [[ ! $version =~ ^16[0-9]{4}$ ]]; then
  echo "Expected PostgreSQL 16 test container; server_version_num was $version" >&2
  exit 1
fi

printf 'CREATE DATABASE "%s";\n' "$db" | admin_sql >/dev/null
created=1
for migration in "$repo_root"/db/quest/migrations/00[1-4]_*.sql; do
  db_sql < "$migration" >/dev/null
done
db_sql < "$repo_root/db/quest/tests/wallet_link_history.sql" >/dev/null

cat <<'SQL' | db_sql >/dev/null
INSERT INTO quest.passports (passport_id)
VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO quest.wallet_bindings (wallet, passport_id)
VALUES (repeat('1', 32), '11111111-1111-4111-8111-111111111111');
SQL

link_sql="INSERT INTO quest.wallet_links (wallet, passport_id, link_evidence_sha256) VALUES (repeat('1', 32), '11111111-1111-4111-8111-111111111111', repeat('a', 64));"
db_sql -qAt -c "$link_sql" > "$out1" 2>&1 &
pid1=$!
db_sql -qAt -c "$link_sql" > "$out2" 2>&1 &
pid2=$!
if wait "$pid1"; then ok1=1; else ok1=0; fi
if wait "$pid2"; then ok2=1; else ok2=0; fi
if (( ok1 + ok2 != 1 )); then
  echo "Expected exactly one concurrent link insert to succeed; got $ok1 + $ok2" >&2
  cat "$out1" "$out2" >&2
  exit 1
fi
active=$(printf "SELECT count(*) FROM quest.wallet_links WHERE network = 'DEVNET' AND wallet = repeat('1', 32) AND unlinked_at IS NULL;\n" | db_sql -At | tr -d '\r\n')
if [[ $active != 1 ]]; then
  echo "Expected one active wallet link; got $active" >&2
  exit 1
fi
