-- Disposable Quest authentication fixture. Apply migrations 001-003 first.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
    IF current_database() !~ '^quest_q2_it_[a-z0-9_]+$' THEN
        RAISE EXCEPTION 'Passport SQL test requires quest_q2_it_* database';
    END IF;
    IF (SELECT count(*) FROM quest.passports) <> 0 OR
       (SELECT count(*) FROM quest.wallet_challenges) <> 0 OR
       (SELECT count(*) FROM quest.passport_sessions) <> 0 THEN
        RAISE EXCEPTION 'Passport SQL test requires empty tables';
    END IF;
END;
$$;

INSERT INTO quest.passports (network, passport_id)
VALUES ('DEVNET', '11111111-1111-4111-8111-111111111111');

DO $$
DECLARE
    passport constant uuid := '11111111-1111-4111-8111-111111111111';
    wallet constant text := repeat('1', 32);
    rejected boolean;
    claimed integer;
    error_message text;
BEGIN
    rejected := false;
    BEGIN
        INSERT INTO quest.wallet_challenges
            (network, nonce_hash, action, passport_id, wallet, domain, issued_at, expires_at)
        VALUES ('MAINNET', repeat('a', 64), 'passport.authenticate',
            passport, wallet, 'solve3.fi', now(), now() + interval '5 minutes');
    EXCEPTION WHEN check_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Mainnet challenge accepted'; END IF;

    rejected := false;
    BEGIN
        INSERT INTO quest.wallet_challenges
            (nonce_hash, action, passport_id, wallet, domain, issued_at, expires_at)
        VALUES ('bad-hash', 'passport.authenticate',
            passport, wallet, 'solve3.fi', now(), now() + interval '5 minutes');
    EXCEPTION WHEN check_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Invalid nonce hash accepted'; END IF;

    rejected := false;
    BEGIN
        INSERT INTO quest.wallet_challenges
            (nonce_hash, action, passport_id, wallet, domain, issued_at, expires_at)
        VALUES (repeat('b', 64), 'passport.authenticate',
            passport, wallet, 'solve3.fi', now(), now());
    EXCEPTION WHEN check_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Invalid challenge expiry accepted'; END IF;

    rejected := false;
    BEGIN
        INSERT INTO quest.wallet_challenges
            (nonce_hash, action, passport_id, wallet, domain, issued_at, expires_at)
        VALUES (repeat('b', 64), 'passport.authenticate',
            passport, wallet, 'solve3.fi', now(), now() + interval '6 minutes');
    EXCEPTION WHEN check_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Long challenge TTL accepted'; END IF;

    INSERT INTO quest.wallet_challenges
        (nonce_hash, action, passport_id, wallet, domain, issued_at, expires_at)
    VALUES (repeat('c', 64), 'passport.authenticate',
        passport, wallet, 'solve3.fi', now(), now() + interval '5 minutes');
    rejected := false;
    BEGIN
        INSERT INTO quest.wallet_challenges
            (nonce_hash, action, passport_id, wallet, domain, issued_at, expires_at)
        VALUES (repeat('c', 64), 'passport.authenticate',
            passport, wallet, 'solve3.fi', now(), now() + interval '5 minutes');
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Duplicate nonce hash accepted'; END IF;

    UPDATE quest.wallet_challenges SET consumed_at = now()
    WHERE network = 'DEVNET' AND nonce_hash = repeat('c', 64)
      AND consumed_at IS NULL AND expires_at > now();
    GET DIAGNOSTICS claimed = ROW_COUNT;
    IF claimed <> 1 THEN RAISE EXCEPTION 'First atomic consume missed'; END IF;
    UPDATE quest.wallet_challenges SET consumed_at = now()
    WHERE network = 'DEVNET' AND nonce_hash = repeat('c', 64)
      AND consumed_at IS NULL AND expires_at > now();
    GET DIAGNOSTICS claimed = ROW_COUNT;
    IF claimed <> 0 THEN RAISE EXCEPTION 'Replay consumed twice'; END IF;
    rejected := false;
    BEGIN
        UPDATE quest.wallet_challenges SET consumed_at = NULL
        WHERE nonce_hash = repeat('c', 64);
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
        IF error_message = 'Passport challenge may only be consumed once' THEN
            rejected := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Consumed challenge was reset'; END IF;

    INSERT INTO quest.wallet_challenges
        (nonce_hash, action, passport_id, wallet, domain, issued_at, expires_at)
    VALUES (repeat('d', 64), 'passport.authenticate',
        passport, wallet, 'solve3.fi',
        now() - interval '10 minutes', now() - interval '5 minutes');
    UPDATE quest.wallet_challenges SET consumed_at = now()
    WHERE network = 'DEVNET' AND nonce_hash = repeat('d', 64)
      AND consumed_at IS NULL AND expires_at > now();
    GET DIAGNOSTICS claimed = ROW_COUNT;
    IF claimed <> 0 THEN RAISE EXCEPTION 'Expired nonce was consumed'; END IF;

    INSERT INTO quest.passport_sessions
        (passport_id, token_hash, csrf_hash, issued_at, expires_at)
    VALUES (passport, repeat('e', 64), repeat('f', 64),
        now(), now() + interval '30 minutes');
    rejected := false;
    BEGIN
        INSERT INTO quest.passport_sessions
            (passport_id, token_hash, csrf_hash, issued_at, expires_at)
        VALUES (passport, repeat('e', 64), repeat('a', 64),
            now(), now() + interval '30 minutes');
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Duplicate session token accepted'; END IF;

    rejected := false;
    BEGIN
        INSERT INTO quest.passport_sessions
            (passport_id, token_hash, csrf_hash, issued_at, expires_at)
        VALUES (passport, repeat('a', 64), repeat('b', 64),
            now(), now() + interval '31 minutes');
    EXCEPTION WHEN check_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Long session TTL accepted'; END IF;

    UPDATE quest.passport_sessions SET revoked_at = now()
    WHERE token_hash = repeat('e', 64);
    GET DIAGNOSTICS claimed = ROW_COUNT;
    IF claimed <> 1 THEN RAISE EXCEPTION 'Session revoke missed'; END IF;
    rejected := false;
    BEGIN
        UPDATE quest.passport_sessions SET revoked_at = NULL
        WHERE token_hash = repeat('e', 64);
    EXCEPTION WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT;
        IF error_message = 'Passport session may only be revoked once' THEN
            rejected := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Revoked session was reset'; END IF;
END;
$$;

ROLLBACK;
