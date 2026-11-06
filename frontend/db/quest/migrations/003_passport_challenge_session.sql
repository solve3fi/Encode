-- Dormant Devnet Passport authentication storage. Apply only to the
-- dedicated Quest database after 001 and 002. No route, writer role, or
-- session issuer is granted by this migration.
-- Rollback after dependent code is removed:
--   DROP TABLE quest.passport_sessions;
--   DROP TABLE quest.wallet_challenges;
BEGIN;

CREATE TABLE quest.wallet_challenges (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
    nonce_hash text NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
    action text NOT NULL CHECK (action = 'passport.authenticate'),
    passport_id uuid NOT NULL,
    wallet text NOT NULL CHECK (length(wallet) BETWEEN 32 AND 44),
    domain text NOT NULL CHECK (length(domain) BETWEEN 1 AND 255),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    FOREIGN KEY (network, passport_id)
        REFERENCES quest.passports (network, passport_id),
    CHECK (expires_at > issued_at),
    CHECK (expires_at <= issued_at + interval '5 minutes'),
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at),
    CHECK (consumed_at IS NULL OR consumed_at < expires_at),
    UNIQUE (network, nonce_hash)
);
CREATE INDEX wallet_challenges_passport
    ON quest.wallet_challenges (network, passport_id, issued_at DESC);

CREATE TABLE quest.passport_sessions (
    session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
    passport_id uuid NOT NULL,
    token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    csrf_hash text NOT NULL CHECK (csrf_hash ~ '^[0-9a-f]{64}$'),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    FOREIGN KEY (network, passport_id)
        REFERENCES quest.passports (network, passport_id),
    CHECK (expires_at > issued_at),
    CHECK (expires_at <= issued_at + interval '30 minutes'),
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
    UNIQUE (network, token_hash)
);
CREATE INDEX passport_sessions_passport
    ON quest.passport_sessions (network, passport_id, issued_at DESC);

-- Runtime roles may eventually update consumed_at/revoked_at. They must not
-- clear a claim, replace a signed challenge, or rotate a session in place.
CREATE FUNCTION quest.guard_wallet_challenge_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR
       ROW(NEW.challenge_id, NEW.network, NEW.nonce_hash, NEW.action,
           NEW.passport_id, NEW.wallet, NEW.domain, NEW.issued_at, NEW.expires_at)
       IS DISTINCT FROM
       ROW(OLD.challenge_id, OLD.network, OLD.nonce_hash, OLD.action,
           OLD.passport_id, OLD.wallet, OLD.domain, OLD.issued_at, OLD.expires_at) THEN
        RAISE EXCEPTION 'Passport challenge may only be consumed once';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_challenges_one_use
    BEFORE UPDATE ON quest.wallet_challenges
    FOR EACH ROW EXECUTE FUNCTION quest.guard_wallet_challenge_update();

CREATE FUNCTION quest.guard_passport_session_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR
       ROW(NEW.session_id, NEW.network, NEW.passport_id, NEW.token_hash,
           NEW.csrf_hash, NEW.issued_at, NEW.expires_at)
       IS DISTINCT FROM
       ROW(OLD.session_id, OLD.network, OLD.passport_id, OLD.token_hash,
           OLD.csrf_hash, OLD.issued_at, OLD.expires_at) THEN
        RAISE EXCEPTION 'Passport session may only be revoked once';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER passport_sessions_one_revoke
    BEFORE UPDATE ON quest.passport_sessions
    FOR EACH ROW EXECUTE FUNCTION quest.guard_passport_session_update();

REVOKE ALL ON quest.wallet_challenges, quest.passport_sessions FROM PUBLIC;
COMMIT;
