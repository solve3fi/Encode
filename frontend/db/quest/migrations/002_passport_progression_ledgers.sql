-- Dormant Devnet Passport progression ledgers. Apply only to the dedicated
-- Quest database after 001_environment_identity.sql. This migration inserts
-- no Passport, XP, Level, Quest, or campaign data and grants no runtime writer.
BEGIN;

CREATE TABLE quest.passports (
    network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
    passport_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (network, passport_id)
);

CREATE TABLE quest.xp_events (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
    passport_id uuid NOT NULL,
    idempotency_key text NOT NULL CHECK (
        length(idempotency_key) BETWEEN 1 AND 256 AND
        idempotency_key = btrim(idempotency_key)
    ),
    kind text NOT NULL CHECK (kind IN ('AWARD', 'REVERSAL')),
    source_event_key text,
    qualification_key text,
    rule_revision integer,
    season_key text CHECK (
        season_key IS NULL OR season_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
    ),
    evidence_sha256 text,
    xp_delta bigint NOT NULL CHECK (xp_delta <> 0),
    reverses_event_id bigint,
    review_ref text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (network, passport_id)
        REFERENCES quest.passports (network, passport_id),
    UNIQUE (network, idempotency_key),
    UNIQUE (network, event_id, passport_id),
    FOREIGN KEY (network, reverses_event_id, passport_id)
        REFERENCES quest.xp_events (network, event_id, passport_id),
    CHECK (
        (kind = 'AWARD' AND xp_delta > 0 AND reverses_event_id IS NULL AND
         review_ref IS NULL AND source_event_key IS NOT NULL AND
         length(source_event_key) BETWEEN 1 AND 256 AND
         qualification_key IS NOT NULL AND
         length(qualification_key) BETWEEN 1 AND 128 AND
         rule_revision IS NOT NULL AND rule_revision > 0 AND
         evidence_sha256 IS NOT NULL AND
         evidence_sha256 ~ '^[0-9a-f]{64}$')
        OR
        (kind = 'REVERSAL' AND xp_delta < 0 AND reverses_event_id IS NOT NULL AND
         review_ref IS NOT NULL AND length(review_ref) BETWEEN 1 AND 256 AND
         source_event_key IS NULL AND qualification_key IS NULL AND
         rule_revision IS NULL AND evidence_sha256 IS NULL)
    )
);

-- The same verified source/qualification cannot be awarded again to another
-- Passport after unlink, relink, replay, or correction. Rule revision is not
-- part of this key; revising a rule must not recycle its source evidence.
CREATE UNIQUE INDEX xp_events_source_qualification_once
    ON quest.xp_events (network, source_event_key, qualification_key)
    WHERE kind = 'AWARD';
CREATE UNIQUE INDEX xp_events_reversal_once
    ON quest.xp_events (reverses_event_id)
    WHERE kind = 'REVERSAL';
CREATE INDEX xp_events_passport_order
    ON quest.xp_events (network, passport_id, event_id);

CREATE TABLE quest.level_events (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
    passport_id uuid NOT NULL,
    idempotency_key text NOT NULL CHECK (
        length(idempotency_key) BETWEEN 1 AND 256 AND
        idempotency_key = btrim(idempotency_key)
    ),
    kind text NOT NULL CHECK (kind IN ('GOVERNANCE_EPOCH', 'REVERSAL')),
    epoch_id bigint CHECK (epoch_id >= 0),
    rule_revision integer,
    evidence_sha256 text,
    level_delta integer NOT NULL,
    reverses_event_id bigint,
    review_ref text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (network, passport_id)
        REFERENCES quest.passports (network, passport_id),
    UNIQUE (network, idempotency_key),
    UNIQUE (network, event_id, passport_id),
    FOREIGN KEY (network, reverses_event_id, passport_id)
        REFERENCES quest.level_events (network, event_id, passport_id),
    CHECK (
        (kind = 'GOVERNANCE_EPOCH' AND level_delta = 1 AND
         epoch_id IS NOT NULL AND rule_revision IS NOT NULL AND
         rule_revision > 0 AND evidence_sha256 IS NOT NULL AND
         evidence_sha256 ~ '^[0-9a-f]{64}$' AND
         reverses_event_id IS NULL AND review_ref IS NULL)
        OR
        (kind = 'REVERSAL' AND level_delta = -1 AND
         epoch_id IS NULL AND rule_revision IS NULL AND
         evidence_sha256 IS NULL AND reverses_event_id IS NOT NULL AND
         review_ref IS NOT NULL AND length(review_ref) BETWEEN 1 AND 256)
    )
);

-- One +1 governance Level per Passport/epoch, regardless of linked wallets,
-- positions, gauges, or repeated votes. A reversal cannot free the key.
CREATE UNIQUE INDEX level_events_governance_epoch_once
    ON quest.level_events (network, passport_id, epoch_id)
    WHERE kind = 'GOVERNANCE_EPOCH';
CREATE UNIQUE INDEX level_events_reversal_once
    ON quest.level_events (reverses_event_id)
    WHERE kind = 'REVERSAL';
CREATE INDEX level_events_passport_order
    ON quest.level_events (network, passport_id, event_id);

CREATE FUNCTION quest.validate_xp_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE original quest.xp_events%ROWTYPE;
BEGIN
    IF NEW.kind = 'REVERSAL' THEN
        SELECT * INTO original FROM quest.xp_events
        WHERE event_id = NEW.reverses_event_id;
        IF NOT FOUND OR original.kind <> 'AWARD' OR
           original.network <> NEW.network OR
           original.passport_id <> NEW.passport_id OR
           NEW.xp_delta <> -original.xp_delta OR
           NEW.season_key IS DISTINCT FROM original.season_key THEN
            RAISE EXCEPTION 'Invalid Quest XP reversal';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER xp_events_validate_reversal BEFORE INSERT ON quest.xp_events
    FOR EACH ROW EXECUTE FUNCTION quest.validate_xp_reversal();

CREATE FUNCTION quest.validate_level_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE original quest.level_events%ROWTYPE;
BEGIN
    IF NEW.kind = 'REVERSAL' THEN
        SELECT * INTO original FROM quest.level_events
        WHERE event_id = NEW.reverses_event_id;
        IF NOT FOUND OR original.kind <> 'GOVERNANCE_EPOCH' OR
           original.network <> NEW.network OR
           original.passport_id <> NEW.passport_id OR
           NEW.level_delta <> -original.level_delta THEN
            RAISE EXCEPTION 'Invalid Quest Level reversal';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER level_events_validate_reversal BEFORE INSERT ON quest.level_events
    FOR EACH ROW EXECUTE FUNCTION quest.validate_level_reversal();

CREATE FUNCTION quest.reject_progression_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Quest progression ledger is append-only';
END;
$$;
CREATE TRIGGER xp_events_immutable BEFORE UPDATE OR DELETE ON quest.xp_events
    FOR EACH ROW EXECUTE FUNCTION quest.reject_progression_mutation();
CREATE TRIGGER xp_events_no_truncate BEFORE TRUNCATE ON quest.xp_events
    FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_progression_mutation();
CREATE TRIGGER level_events_immutable BEFORE UPDATE OR DELETE ON quest.level_events
    FOR EACH ROW EXECUTE FUNCTION quest.reject_progression_mutation();
CREATE TRIGGER level_events_no_truncate BEFORE TRUNCATE ON quest.level_events
    FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_progression_mutation();

REVOKE ALL ON quest.passports, quest.xp_events, quest.level_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE quest.xp_events_event_id_seq,
    quest.level_events_event_id_seq FROM PUBLIC;

COMMIT;
