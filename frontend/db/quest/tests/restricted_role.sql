-- Run as a separately connected, restricted LOGIN role in a disposable
-- quest_q1_it_* database after one test identity row has been inserted and
-- USAGE on quest + SELECT on environment_identity have been granted.
\set ON_ERROR_STOP on
DO $$
BEGIN
    IF current_database() !~ '^quest_q1_it_[a-z0-9_]+$' THEN
        RAISE EXCEPTION 'Restricted-role test requires a disposable quest_q1_it_* database';
    END IF;
    IF session_user <> current_user OR
       (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Restricted-role test requires a non-superuser login';
    END IF;
    IF has_schema_privilege(current_user, 'quest', 'CREATE') OR
       has_schema_privilege(current_user, 'public', 'CREATE') OR
       has_database_privilege(current_user, current_database(), 'CREATE') OR
       has_table_privilege(current_user, 'quest.environment_identity', 'INSERT') OR
       has_table_privilege(current_user, 'quest.environment_identity', 'UPDATE') OR
       has_table_privilege(current_user, 'quest.environment_identity', 'DELETE') OR
       has_table_privilege(current_user, 'quest.environment_identity', 'TRUNCATE') THEN
        RAISE EXCEPTION 'Restricted login has excessive privileges';
    END IF;
    IF (SELECT count(*) FROM quest.environment_identity) <> 1 THEN
        RAISE EXCEPTION 'Restricted login cannot read exactly one identity row';
    END IF;
END;
$$;
