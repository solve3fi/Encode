#!/usr/bin/env bash
# Apply dormant Quest progression migrations and SQL constraints in one
# generated PostgreSQL 16 test database, then remove it. Never use deployment.
set -euo pipefail

if [[ $# -ne 2 || $1 != --container || ! $2 =~ ^[a-zA-Z0-9_.-]+$ || ! $2 =~ (^|[-_])test($|[-_]) ]]; then
  echo 'Usage: rehearse-progression-ledgers.sh --container <postgres-16-test-container>' >&2
  exit 2
fi

container=$2
docker_cli=${DOCKER_CLI:-docker}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
db="quest_q1_it_$(date -u +%Y%m%d%H%M%S)_${BASHPID}"
created=0

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
  if (( created )); then
    printf 'DROP DATABASE "%s" WITH (FORCE);\n' "$db" | admin_sql >/dev/null
    (( $? == 0 )) || status=1
    remaining=$(printf "SELECT count(*) FROM pg_database WHERE datname = '%s';\n" "$db" | admin_sql -At | tr -d '\r\n')
    if [[ $remaining != 0 ]]; then
      echo "Expected no rehearsal database; catalog count: $remaining" >&2
      status=1
    fi
  fi
  if (( status == 0 )); then
    echo 'Quest progression ledger rehearsal passed; temporary database removed.'
  else
    echo 'Quest progression ledger rehearsal failed; check cleanup output above.' >&2
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
db_sql < "$repo_root/db/quest/tests/progression_ledgers.sql" >/dev/null

rows=$(printf 'SELECT (SELECT count(*) FROM quest.passports) + (SELECT count(*) FROM quest.xp_events) + (SELECT count(*) FROM quest.level_events);\n' | db_sql -At | tr -d '\r\n')
if [[ $rows != 0 ]]; then
  echo "Expected empty progression tables after rollback; row count: $rows" >&2
  exit 1
fi
