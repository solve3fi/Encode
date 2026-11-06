#!/usr/bin/env bash
# Rehearse dormant Q2 SQL on an explicitly named PostgreSQL 16 test container.
set -euo pipefail

if [[ $# -ne 2 || $1 != --container || ! $2 =~ ^[a-zA-Z0-9_.-]+$ || ! $2 =~ (^|[-_])test($|[-_]) ]]; then
  echo 'Usage: rehearse-passport-auth.sh --container <postgres-16-test-container>' >&2
  exit 2
fi

container=$2
docker_cli=${DOCKER_CLI:-docker}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
db="quest_q2_it_$(date -u +%Y%m%d%H%M%S)_${BASHPID}"
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
      echo "Expected no Q2 rehearsal database; catalog count: $remaining" >&2
      status=1
    fi
  fi
  if (( status == 0 )); then
    echo 'Passport authentication rehearsal passed; temporary database removed.'
  else
    echo 'Passport authentication rehearsal failed; check cleanup output above.' >&2
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
db_sql < "$repo_root/db/quest/migrations/001_environment_identity.sql" >/dev/null
db_sql < "$repo_root/db/quest/migrations/002_passport_progression_ledgers.sql" >/dev/null
db_sql < "$repo_root/db/quest/migrations/003_passport_challenge_session.sql" >/dev/null
db_sql < "$repo_root/db/quest/tests/passport_challenge_constraints.sql" >/dev/null

cat <<'SQL' | db_sql >/dev/null
INSERT INTO quest.passports (passport_id)
VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO quest.wallet_challenges
    (nonce_hash, action, passport_id, wallet, domain, issued_at, expires_at)
VALUES (repeat('0', 64), 'passport.authenticate',
    '11111111-1111-4111-8111-111111111111', repeat('1', 32),
    'solve3.fi', now(), now() + interval '5 minutes');
SQL

consume_sql="UPDATE quest.wallet_challenges SET consumed_at = now() WHERE network = 'DEVNET' AND nonce_hash = repeat('0', 64) AND consumed_at IS NULL AND expires_at > now() RETURNING challenge_id;"
db_sql -qAt -c "$consume_sql" > "$out1" &
pid1=$!
db_sql -qAt -c "$consume_sql" > "$out2" &
pid2=$!
wait "$pid1"
wait "$pid2"

count1=$(wc -l < "$out1")
count2=$(wc -l < "$out2")
if (( count1 + count2 != 1 )); then
  echo "Expected exactly one claim under concurrency; got $count1 + $count2" >&2
  exit 1
fi
db_sql -qAt -c "$consume_sql" > "$out1"
if [[ -s $out1 ]]; then
  echo 'Replay unexpectedly claimed the challenge' >&2
  exit 1
fi
