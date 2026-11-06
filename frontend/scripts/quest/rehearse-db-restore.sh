#!/usr/bin/env bash
# Exercise the dormant Quest identity migration and a logical restore in a
# PostgreSQL 16 test container. Never point this at a deployment container.
set -euo pipefail

if [[ $# -ne 2 || $1 != --container || ! $2 =~ ^[a-zA-Z0-9_.-]+$ || ! $2 =~ (^|[-_])test($|[-_]) ]]; then
  echo 'Usage: rehearse-db-restore.sh --container <postgres-16-test-container>' >&2
  exit 2
fi

container=$2
docker_cli=${DOCKER_CLI:-docker}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
suffix="$(date -u +%Y%m%d%H%M%S)_${BASHPID}"
source_db="quest_q1_it_${suffix}"
restore_db="quest_q1_it_${suffix}_restore"
runtime_role="quest_q1_it_${suffix}_role"
dump_file=$(mktemp)
source_created=0
restore_created=0
role_created=0

admin_sql() {
  "$docker_cli" exec -i "$container" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres "$@"' sh "$@"
}

db_sql() {
  "$docker_cli" exec -i "$container" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$1"
}

cleanup() {
  status=$?
  trap - EXIT
  set +e
  if (( restore_created )); then
    printf 'DROP DATABASE "%s" WITH (FORCE);\n' "$restore_db" | admin_sql >/dev/null
    (( $? == 0 )) || status=1
  fi
  if (( source_created )); then
    printf 'DROP DATABASE "%s" WITH (FORCE);\n' "$source_db" | admin_sql >/dev/null
    (( $? == 0 )) || status=1
  fi
  if (( role_created )); then
    printf 'DROP ROLE "%s";\n' "$runtime_role" | admin_sql >/dev/null
    (( $? == 0 )) || status=1
  fi
  if (( source_created || restore_created || role_created )); then
    remaining=$(printf "SELECT (SELECT count(*) FROM pg_database WHERE datname IN ('%s', '%s')) + (SELECT count(*) FROM pg_roles WHERE rolname = '%s');\n" \
      "$source_db" "$restore_db" "$runtime_role" | admin_sql -At | tr -d '\r\n')
    if [[ $remaining != 0 ]]; then
      echo "Expected no rehearsal databases or role; catalog count: $remaining" >&2
      status=1
    fi
  fi
  rm -f -- "$dump_file"
  if (( status == 0 )); then
    echo 'Quest database restore rehearsal passed; temporary databases and role removed.'
  else
    echo 'Quest database restore rehearsal failed; check cleanup output above.' >&2
  fi
  exit "$status"
}
trap cleanup EXIT

version=$(printf 'SHOW server_version_num;\n' | admin_sql -At | tr -d '\r\n')
if [[ ! $version =~ ^16[0-9]{4}$ ]]; then
  echo "Expected PostgreSQL 16 test container; server_version_num was $version" >&2
  exit 1
fi

printf 'CREATE ROLE "%s" NOLOGIN;\n' "$runtime_role" | admin_sql >/dev/null
role_created=1
printf 'CREATE DATABASE "%s";\n' "$source_db" | admin_sql >/dev/null
source_created=1

db_sql "$source_db" < "$repo_root/db/quest/migrations/001_environment_identity.sql" >/dev/null
db_sql "$source_db" < "$repo_root/db/quest/tests/identity_constraints.sql" >/dev/null

# All identifiers are generated from digits, letters, and underscores above.
cat <<SQL | admin_sql >/dev/null
REVOKE ALL ON DATABASE "$source_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE "$source_db" TO "$runtime_role";
SQL
cat <<SQL | db_sql "$source_db" >/dev/null
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA quest TO "$runtime_role";
GRANT SELECT ON quest.environment_identity TO "$runtime_role";
INSERT INTO quest.environment_identity
  (network, genesis_hash, environment_id, manifest_sha256, namespace)
VALUES
  ('DEVNET', 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
   '00000000-0000-4000-8000-000000000001', repeat('0', 64), 'quest');
SQL

"$docker_cli" exec "$container" sh -c \
  'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$1"' sh "$source_db" > "$dump_file"
if [[ ! -s $dump_file ]]; then
  echo 'pg_dump produced an empty archive' >&2
  exit 1
fi

printf 'CREATE DATABASE "%s";\n' "$restore_db" | admin_sql >/dev/null
restore_created=1
cat <<SQL | admin_sql >/dev/null
REVOKE ALL ON DATABASE "$restore_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE "$restore_db" TO "$runtime_role";
SQL
"$docker_cli" exec -i "$container" sh -c \
  'exec pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$1"' sh "$restore_db" < "$dump_file"

cat <<SQL | db_sql "$restore_db" >/dev/null
DO \$\$
BEGIN
  IF current_database() <> '$restore_db'
     OR (SELECT count(*) FROM quest.environment_identity) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM quest.environment_identity
       WHERE network = 'DEVNET'
         AND genesis_hash = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
         AND environment_id = '00000000-0000-4000-8000-000000000001'
         AND manifest_sha256 = repeat('0', 64)
         AND namespace = 'quest')
     OR NOT has_database_privilege('$runtime_role', current_database(), 'CONNECT')
     OR has_database_privilege('$runtime_role', current_database(), 'CREATE')
     OR NOT has_schema_privilege('$runtime_role', 'quest', 'USAGE')
     OR has_schema_privilege('$runtime_role', 'quest', 'CREATE')
     OR has_schema_privilege('$runtime_role', 'public', 'CREATE')
     OR NOT has_table_privilege('$runtime_role', 'quest.environment_identity', 'SELECT')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'INSERT')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'UPDATE')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'DELETE')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'TRUNCATE')
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'quest.environment_identity'::regclass
         AND tgname = 'environment_identity_immutable'
         AND tgenabled = 'O')
  THEN
    RAISE EXCEPTION 'Quest restore identity or least-privilege check failed';
  END IF;
END;
\$\$;
SQL
