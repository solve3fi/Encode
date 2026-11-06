-- Run with the *same connection and login role* intended for a Quest worker.
-- Return this one row to assertQuestDevnetStartup; do not treat this query as
-- manifest approval or proof of separate infrastructure by itself.
SELECT
    current_database()::text AS "databaseName",
    session_user::text AS "sessionUser",
    current_user::text AS "currentUser",
    (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS "superuser",
    has_schema_privilege(current_user, 'quest', 'CREATE') AS "canCreateQuestObjects",
    has_schema_privilege(current_user, 'public', 'CREATE') AS "canCreatePublicObjects",
    has_database_privilege(current_user, current_database(), 'CREATE') AS "canCreateDatabaseObjects",
    (
        has_table_privilege(current_user, 'quest.environment_identity', 'INSERT') OR
        has_table_privilege(current_user, 'quest.environment_identity', 'UPDATE') OR
        has_table_privilege(current_user, 'quest.environment_identity', 'DELETE') OR
        has_table_privilege(current_user, 'quest.environment_identity', 'TRUNCATE')
    ) AS "canMutateIdentity",
    (
        SELECT row_to_json(identity_row)
        FROM (
            SELECT network,
                   genesis_hash AS "genesisHash",
                   environment_id::text AS "environmentId",
                   manifest_sha256 AS "manifestSha256",
                   namespace
            FROM quest.environment_identity
            WHERE singleton = true
        ) AS identity_row
    ) AS identity;
