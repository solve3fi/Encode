-- Run only after migrations 001 and 002 in an empty disposable quest_q1_it_*
-- PostgreSQL 16 database. All fixture rows roll back.
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
    first_passport uuid := '11111111-1111-4111-8111-111111111111';
    second_passport uuid := '22222222-2222-4222-8222-222222222222';
    award_id bigint;
    governance_id bigint;
    rejected boolean;
BEGIN
    IF current_database() !~ '^quest_q1_it_[a-z0-9_]+$' THEN
        RAISE EXCEPTION 'Quest progression test requires a disposable quest_q1_it_* database';
    END IF;
    INSERT INTO quest.passports (passport_id)
    VALUES (first_passport), (second_passport);

    INSERT INTO quest.xp_events
        (passport_id, idempotency_key, kind, source_event_key,
         qualification_key, rule_revision, season_key, evidence_sha256,
         xp_delta)
    VALUES
        (first_passport, 'test-award-1', 'AWARD', 'test:swap:1',
         'first_swap', 1, 'season_test', repeat('a', 64), 250)
    RETURNING event_id INTO award_id;

    rejected := false;
    BEGIN
        INSERT INTO quest.xp_events
            (passport_id, idempotency_key, kind, source_event_key,
             qualification_key, rule_revision, evidence_sha256, xp_delta)
        VALUES
            (second_passport, 'test-award-2', 'AWARD', 'test:swap:1',
             'first_swap', 2, repeat('b', 64), 250);
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Cross-Passport replay was accepted'; END IF;

    rejected := false;
    BEGIN
        INSERT INTO quest.xp_events
            (passport_id, idempotency_key, kind, source_event_key,
             qualification_key, xp_delta)
        VALUES
            (first_passport, 'test-missing-evidence', 'AWARD',
             'test:swap:2', 'first_swap', 250);
    EXCEPTION WHEN check_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Unpinned XP award was accepted'; END IF;

    rejected := false;
    BEGIN
        INSERT INTO quest.xp_events
            (passport_id, idempotency_key, kind, xp_delta,
             reverses_event_id, review_ref, season_key)
        VALUES
            (first_passport, 'test-bad-reversal', 'REVERSAL', -249,
             award_id, 'test-review', 'season_test');
    EXCEPTION WHEN raise_exception THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Partial XP reversal was accepted'; END IF;

    INSERT INTO quest.xp_events
        (passport_id, idempotency_key, kind, xp_delta,
         reverses_event_id, review_ref, season_key)
    VALUES
        (first_passport, 'test-reversal-1', 'REVERSAL', -250,
         award_id, 'test-review', 'season_test');

    rejected := false;
    BEGIN
        INSERT INTO quest.xp_events
            (passport_id, idempotency_key, kind, xp_delta,
             reverses_event_id, review_ref, season_key)
        VALUES
            (first_passport, 'test-reversal-2', 'REVERSAL', -250,
             award_id, 'test-review-2', 'season_test');
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Duplicate XP reversal was accepted'; END IF;

    rejected := false;
    BEGIN
        INSERT INTO quest.xp_events
            (passport_id, idempotency_key, kind, source_event_key,
             qualification_key, rule_revision, evidence_sha256, xp_delta)
        VALUES
            (second_passport, 'test-reaward', 'AWARD', 'test:swap:1',
             'first_swap', 3, repeat('c', 64), 250);
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Reaward after reversal was accepted'; END IF;

    INSERT INTO quest.level_events
        (passport_id, idempotency_key, kind, epoch_id,
         rule_revision, evidence_sha256, level_delta)
    VALUES
        (first_passport, 'test-governance-1', 'GOVERNANCE_EPOCH', 42,
         1, repeat('d', 64), 1)
    RETURNING event_id INTO governance_id;

    rejected := false;
    BEGIN
        INSERT INTO quest.level_events
            (passport_id, idempotency_key, kind, epoch_id,
             rule_revision, evidence_sha256, level_delta)
        VALUES
            (first_passport, 'test-governance-2', 'GOVERNANCE_EPOCH', 42,
             1, repeat('e', 64), 1);
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Second Level in one epoch was accepted'; END IF;

    INSERT INTO quest.level_events
        (passport_id, idempotency_key, kind, level_delta,
         reverses_event_id, review_ref)
    VALUES
        (first_passport, 'test-governance-reversal', 'REVERSAL', -1,
         governance_id, 'test-review');

    IF (SELECT count(*) FROM quest.xp_events WHERE passport_id = first_passport) <> 2 OR
       (SELECT coalesce(sum(xp_delta), 0) FROM quest.xp_events
        WHERE passport_id = first_passport) <> 0 OR
       (SELECT count(*) FROM quest.level_events WHERE passport_id = first_passport) <> 2 OR
       (SELECT coalesce(sum(level_delta), 0) FROM quest.level_events
        WHERE passport_id = first_passport) <> 0 THEN
        RAISE EXCEPTION 'Quest progression replay totals are wrong';
    END IF;

    rejected := false;
    BEGIN
        UPDATE quest.xp_events SET xp_delta = 1 WHERE event_id = award_id;
    EXCEPTION WHEN raise_exception THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'XP UPDATE was accepted'; END IF;

    rejected := false;
    BEGIN
        DELETE FROM quest.level_events WHERE event_id = governance_id;
    EXCEPTION WHEN raise_exception THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Level DELETE was accepted'; END IF;

    rejected := false;
    BEGIN
        TRUNCATE quest.xp_events;
    EXCEPTION WHEN raise_exception THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'XP TRUNCATE was accepted'; END IF;
END;
$$;

ROLLBACK;
