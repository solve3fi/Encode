#!/usr/bin/env bash
# Bootstrap a disposable PostgreSQL 16 Q1 lab in a test container: a source
# database, a restore database, and a NOLOGIN runtime role; then apply the
# real Quest environment-identity migration and constraint test, insert a
# clearly test-only identity row, revoke PUBLIC privileges, and prove the
# restricted role holds only CONNECT/USAGE/SELECT. Never point this at a
# deployment/DEX container, and never touch live data.
set -euo pipefail

if [[ $# -ne 2 || $1 != --container || ! $2 =~ ^[a-zA-Z0-9_.-]+$ || ! $2 =~ (^|[-_])test($|[-_]) ]]; then
  echo 'Usage: rehearse-q1-lab.sh --container <postgres-16-test-container>' >&2
  exit 2
fi

container=$2
docker_cli=${DOCKER_CLI:-docker}
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/../.." && pwd)
migration_sql="$repo_root/db/quest/migrations/001_environment_identity.sql"
constraints_sql="$repo_root/db/quest/tests/identity_constraints.sql"
suffix="$(date -u +%Y%m%d%H%M%S)_${BASHPID}"
source_db="quest_q1_it_${suffix}"
restore_db="quest_q1_it_${suffix}_restore"
runtime_role="quest_q1_it_${suffix}_role"
source_created=0
restore_created=0
role_created=0
dump_file=

admin_sql() {
  "$docker_cli" exec -i "$container" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres "$@"' sh "$@"
}

# Run SQL read from stdin against the disposable source database. Only the
# self-created source database is ever targeted here.
source_sql() {
  "$docker_cli" exec -i "$container" sh -c \
    'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$source_db"
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
  if [[ -n $dump_file ]]; then
    rm -f -- "$dump_file"
  fi
  if (( status == 0 )); then
    echo 'Q1 lab rehearsal passed; temporary databases and role removed.'
  else
    echo 'Q1 lab rehearsal failed; check cleanup output above.' >&2
  fi
  exit "$status"
}
trap cleanup EXIT

version=$(printf 'SHOW server_version_num;\n' | admin_sql -At | tr -d '\r\n')
if [[ ! $version =~ ^16[0-9]{4}$ ]]; then
  echo "Expected PostgreSQL 16 test container; server_version_num was $version" >&2
  exit 1
fi
echo "checkpoint: container $container is PostgreSQL $version"

# Driver-free planning check first: exercise the real on-disk migration file
# through the checksummed planner before any lab database or role is created.
(
  cd "$repo_root"
  node --test "$script_dir/test-migrate-on-disk.mjs"
)

printf 'CREATE ROLE "%s" NOLOGIN;\n' "$runtime_role" | admin_sql >/dev/null
role_created=1
printf 'CREATE DATABASE "%s";\n' "$source_db" | admin_sql >/dev/null
source_created=1
printf 'CREATE DATABASE "%s";\n' "$restore_db" | admin_sql >/dev/null
restore_created=1
echo "checkpoint: created disposable source $source_db, restore $restore_db and NOLOGIN role $runtime_role"

# Apply the real identity migration, then exercise its constraints. Both files
# only permit the disposable quest_q1_it_* database created above.
source_sql <"$migration_sql" >/dev/null
source_sql <"$constraints_sql" >/dev/null

# A clearly test-only identity row: the zero UUID and an all-zero manifest hash
# that can never correspond to a reviewed manifest.
source_sql >/dev/null <<SQL
INSERT INTO quest.environment_identity
    (network, genesis_hash, environment_id, manifest_sha256, namespace)
VALUES
    ('DEVNET', 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
     '00000000-0000-4000-8000-000000000001', repeat('0', 64), 'quest');
SQL

# Strip PUBLIC first, then grant the runtime role the exact least privilege.
source_sql >/dev/null <<SQL
REVOKE ALL ON DATABASE "$source_db" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE "$source_db" TO "$runtime_role";
GRANT USAGE ON SCHEMA quest TO "$runtime_role";
GRANT SELECT ON quest.environment_identity TO "$runtime_role";
SQL

# Prove the restricted role holds exactly CONNECT/USAGE/SELECT and nothing more.
source_sql >/dev/null <<SQL
DO \$\$
DECLARE
    role_name text := '$runtime_role';
    db_name text := '$source_db';
BEGIN
    IF NOT has_database_privilege(role_name, db_name, 'CONNECT') THEN
        RAISE EXCEPTION 'restricted role is missing CONNECT on the database';
    END IF;
    IF has_database_privilege(role_name, db_name, 'CREATE') THEN
        RAISE EXCEPTION 'restricted role must not have CREATE on the database';
    END IF;
    IF has_database_privilege(role_name, db_name, 'TEMPORARY') THEN
        RAISE EXCEPTION 'restricted role must not have TEMPORARY on the database';
    END IF;

    IF NOT has_schema_privilege(role_name, 'quest', 'USAGE') THEN
        RAISE EXCEPTION 'restricted role is missing USAGE on schema quest';
    END IF;
    IF has_schema_privilege(role_name, 'quest', 'CREATE') THEN
        RAISE EXCEPTION 'restricted role must not have CREATE on schema quest';
    END IF;
    IF has_schema_privilege(role_name, 'public', 'CREATE') THEN
        RAISE EXCEPTION 'restricted role must not have CREATE on schema public';
    END IF;

    IF NOT has_table_privilege(role_name, 'quest.environment_identity', 'SELECT') THEN
        RAISE EXCEPTION 'restricted role is missing SELECT on quest.environment_identity';
    END IF;
    IF has_table_privilege(role_name, 'quest.environment_identity', 'INSERT') THEN
        RAISE EXCEPTION 'restricted role must not have INSERT on quest.environment_identity';
    END IF;
    IF has_table_privilege(role_name, 'quest.environment_identity', 'UPDATE') THEN
        RAISE EXCEPTION 'restricted role must not have UPDATE on quest.environment_identity';
    END IF;
    IF has_table_privilege(role_name, 'quest.environment_identity', 'DELETE') THEN
        RAISE EXCEPTION 'restricted role must not have DELETE on quest.environment_identity';
    END IF;
    IF has_table_privilege(role_name, 'quest.environment_identity', 'TRUNCATE') THEN
        RAISE EXCEPTION 'restricted role must not have TRUNCATE on quest.environment_identity';
    END IF;
    IF has_table_privilege(role_name, 'quest.environment_identity', 'REFERENCES') THEN
        RAISE EXCEPTION 'restricted role must not have REFERENCES on quest.environment_identity';
    END IF;
    IF has_table_privilege(role_name, 'quest.environment_identity', 'TRIGGER') THEN
        RAISE EXCEPTION 'restricted role must not have TRIGGER on quest.environment_identity';
    END IF;

    IF (SELECT count(*) FROM quest.environment_identity) <> 1 THEN
        RAISE EXCEPTION 'expected exactly one test identity row';
    END IF;
END;
\$\$;
SQL
echo 'checkpoint: source identity row applied and restricted role limited to CONNECT/USAGE/SELECT'

# Exercise a real logical backup archive. The archive stays on this machine,
# never in the repository or a deployment container.
dump_file=$(mktemp)
"$docker_cli" exec "$container" sh -c \
  'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$1"' sh "$source_db" >"$dump_file"
if [[ ! -s $dump_file ]]; then
  echo 'pg_dump produced an empty archive' >&2
  exit 1
fi
echo "checkpoint: pg_dump -Fc archive is non-empty ($(wc -c <"$dump_file" | tr -d ' ') bytes)"
"$docker_cli" exec -i "$container" sh -c \
  'exec pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$1"' sh "$restore_db" <"$dump_file"
echo 'checkpoint: pg_restore --exit-on-error completed into the restore database'

# pg_dump does not transfer database-level ACLs into an existing target
# database. Apply only the same restricted CONNECT grant to our own target.
cat <<SQL | admin_sql >/dev/null
REVOKE ALL ON DATABASE "$restore_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE "$restore_db" TO "$runtime_role";
SQL

"$docker_cli" exec -i "$container" sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$restore_db" >/dev/null <<SQL
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
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'quest.environment_identity'::regclass
         AND tgname = 'environment_identity_immutable'
         AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$runtime_role' AND NOT rolcanlogin)
     OR NOT has_database_privilege('$runtime_role', current_database(), 'CONNECT')
     OR has_database_privilege('$runtime_role', current_database(), 'CREATE')
     OR has_database_privilege('$runtime_role', current_database(), 'TEMPORARY')
     OR NOT has_schema_privilege('$runtime_role', 'quest', 'USAGE')
     OR has_schema_privilege('$runtime_role', 'quest', 'CREATE')
     OR has_schema_privilege('$runtime_role', 'public', 'CREATE')
     OR NOT has_table_privilege('$runtime_role', 'quest.environment_identity', 'SELECT')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'INSERT')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'UPDATE')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'DELETE')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'TRUNCATE')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'REFERENCES')
     OR has_table_privilege('$runtime_role', 'quest.environment_identity', 'TRIGGER')
  THEN
    RAISE EXCEPTION 'Quest restore identity, trigger, or restricted-role check failed';
  END IF;
END;
\$\$;
SQL
echo 'checkpoint: restored identity row, enabled immutable trigger and restricted grants verified'
