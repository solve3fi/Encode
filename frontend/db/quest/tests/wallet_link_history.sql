-- Disposable Q3 fixture. Apply migrations 001-004 first.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
    IF current_database() !~ '^quest_q3_it_[a-z0-9_]+$' THEN
        RAISE EXCEPTION 'Wallet link test requires quest_q3_it_* database';
    END IF;
    IF (SELECT count(*) FROM quest.passports) <> 0 OR
       (SELECT count(*) FROM quest.wallet_bindings) <> 0 OR
       (SELECT count(*) FROM quest.wallet_links) <> 0 THEN
        RAISE EXCEPTION 'Wallet link test requires empty tables';
    END IF;
END;
$$;

INSERT INTO quest.passports (passport_id) VALUES
    ('11111111-1111-4111-8111-111111111111'),
    ('22222222-2222-4222-8222-222222222222');

DO $$
DECLARE
    p1 constant uuid := '11111111-1111-4111-8111-111111111111';
    p2 constant uuid := '22222222-2222-4222-8222-222222222222';
    wallet_key constant text := repeat('1', 32);
    first_link_id bigint;
    rejected boolean;
    attributed uuid;
BEGIN
    INSERT INTO quest.wallet_bindings (wallet, passport_id)
    VALUES (wallet_key, p1);
    INSERT INTO quest.wallet_links
        (wallet, passport_id, linked_at, link_evidence_sha256)
    VALUES (wallet_key, p1, now() - interval '2 days', repeat('a', 64))
    RETURNING link_id INTO first_link_id;

    -- A second active interval and an overlapping historical interval fail.
    rejected := false;
    BEGIN
        INSERT INTO quest.wallet_links
            (wallet, passport_id, linked_at, link_evidence_sha256)
        VALUES (wallet_key, p1, now() - interval '1 day', repeat('b', 64));
    EXCEPTION WHEN raise_exception OR unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Second active link accepted'; END IF;

    rejected := false;
    BEGIN
        INSERT INTO quest.wallet_bindings (wallet, passport_id)
        VALUES (wallet_key, p2);
    EXCEPTION WHEN unique_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Cross-Passport wallet claim accepted'; END IF;

    UPDATE quest.wallet_links
    SET unlinked_at = now() - interval '1 day',
        unlink_evidence_sha256 = repeat('c', 64)
    WHERE link_id = first_link_id;
    rejected := false;
    BEGIN
        UPDATE quest.wallet_links SET unlinked_at = NULL,
            unlink_evidence_sha256 = NULL WHERE link_id = first_link_id;
    EXCEPTION WHEN raise_exception THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Closed link reopened'; END IF;

    -- Event-time attribution excludes pre-link and post-unlink events.
    SELECT passport_id INTO attributed FROM quest.wallet_links
    WHERE network = 'DEVNET' AND wallet = wallet_key
      AND linked_at <= now() - interval '3 days'
      AND (unlinked_at IS NULL OR now() - interval '3 days' < unlinked_at);
    IF attributed IS NOT NULL THEN RAISE EXCEPTION 'Pre-link event attributed'; END IF;
    SELECT passport_id INTO attributed FROM quest.wallet_links
    WHERE network = 'DEVNET' AND wallet = wallet_key
      AND linked_at <= now() - interval '36 hours'
      AND (unlinked_at IS NULL OR now() - interval '36 hours' < unlinked_at);
    IF attributed IS DISTINCT FROM p1 THEN RAISE EXCEPTION 'Linked event missed'; END IF;
    SELECT passport_id INTO attributed FROM quest.wallet_links
    WHERE network = 'DEVNET' AND wallet = wallet_key
      AND linked_at <= now() - interval '12 hours'
      AND (unlinked_at IS NULL OR now() - interval '12 hours' < unlinked_at);
    IF attributed IS NOT NULL THEN RAISE EXCEPTION 'Unlinked event attributed'; END IF;

    INSERT INTO quest.wallet_links
        (wallet, passport_id, linked_at, link_evidence_sha256)
    VALUES (wallet_key, p1, now(), repeat('d', 64));
    SELECT passport_id INTO attributed FROM quest.wallet_links
    WHERE network = 'DEVNET' AND wallet = wallet_key
      AND unlinked_at IS NULL AND linked_at <= now();
    IF attributed IS DISTINCT FROM p1 THEN
        RAISE EXCEPTION 'Active owner lookup missed relink';
    END IF;
    rejected := false;
    BEGIN
        INSERT INTO quest.wallet_links
            (wallet, passport_id, linked_at, unlinked_at,
             link_evidence_sha256, unlink_evidence_sha256)
        VALUES (wallet_key, p1, now() - interval '36 hours',
            now() - interval '12 hours', repeat('e', 64), repeat('f', 64));
    EXCEPTION WHEN raise_exception THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Historical overlap accepted'; END IF;

    rejected := false;
    BEGIN
        DELETE FROM quest.wallet_bindings WHERE wallet = wallet_key;
    EXCEPTION WHEN raise_exception THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Wallet binding deleted'; END IF;
END;
$$;

ROLLBACK;
