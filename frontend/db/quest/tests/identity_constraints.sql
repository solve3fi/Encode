-- Run only against a NEW, empty, disposable database named quest_q1_it_*.
-- Apply migrations/001_environment_identity.sql first, as the migration role.
-- The transaction rolls back the fixture row after all assertions.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
    IF current_database() !~ '^quest_q1_it_[a-z0-9_]+$' THEN
        RAISE EXCEPTION 'Quest identity SQL test requires a disposable quest_q1_it_* database';
    END IF;
    IF (SELECT count(*) FROM quest.environment_identity) <> 0 THEN
        RAISE EXCEPTION 'Quest identity SQL test requires an empty identity table';
    END IF;
END;
$$;

DO $$
DECLARE
    test_genesis constant text := 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
    test_uuid constant uuid := '11111111-1111-4111-8111-111111111111';
    test_hash constant text := repeat('a', 64);
    error_message text;
BEGIN
    BEGIN
        INSERT INTO quest.environment_identity (network, genesis_hash, environment_id, manifest_sha256, namespace)
        VALUES ('MAINNET', test_genesis, test_uuid, test_hash, 'quest');
        RAISE EXCEPTION 'Mainnet identity unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO quest.environment_identity (network, genesis_hash, environment_id, manifest_sha256, namespace)
        VALUES ('DEVNET', 'wrong-genesis', test_uuid, test_hash, 'quest');
        RAISE EXCEPTION 'Wrong genesis unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO quest.environment_identity (network, genesis_hash, environment_id, manifest_sha256, namespace)
        VALUES ('DEVNET', test_genesis, test_uuid, test_hash, 'mainnet');
        RAISE EXCEPTION 'Wrong namespace unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO quest.environment_identity (network, genesis_hash, environment_id, manifest_sha256, namespace)
        VALUES ('DEVNET', test_genesis, test_uuid, 'not-a-sha256', 'quest');
        RAISE EXCEPTION 'Invalid manifest hash unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO quest.environment_identity (singleton, network, genesis_hash, environment_id, manifest_sha256, namespace)
        VALUES (false, 'DEVNET', test_genesis, test_uuid, test_hash, 'quest');
        RAISE EXCEPTION 'False singleton unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    INSERT INTO quest.environment_identity (network, genesis_hash, environment_id, manifest_sha256, namespace)
    VALUES ('DEVNET', test_genesis, test_uuid, test_hash, 'quest');

    BEGIN
        INSERT INTO quest.environment_identity (network, genesis_hash, environment_id, manifest_sha256, namespace)
        VALUES ('DEVNET', test_genesis, test_uuid, test_hash, 'quest');
        RAISE EXCEPTION 'Duplicate singleton unexpectedly accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    BEGIN
        UPDATE quest.environment_identity SET namespace = 'other' WHERE singleton = true;
        RAISE EXCEPTION 'Identity UPDATE unexpectedly accepted';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
        IF error_message <> 'Quest environment identity is immutable' THEN RAISE; END IF;
    END;

    BEGIN
        DELETE FROM quest.environment_identity WHERE singleton = true;
        RAISE EXCEPTION 'Identity DELETE unexpectedly accepted';
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
        IF error_message <> 'Quest environment identity is immutable' THEN RAISE; END IF;
    END;

    IF (SELECT count(*) FROM quest.environment_identity) <> 1 THEN
        RAISE EXCEPTION 'Identity row changed after rejected mutations';
    END IF;
END;
$$;

ROLLBACK;
