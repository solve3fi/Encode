-- Apply only to a dedicated, empty Devnet Quest PostgreSQL database using a
-- migration role. This creates an identity anchor, not a Quest worker or award.
-- Provision login roles and the database outside this migration; do not run it
-- against the DEX or Mainnet database.
BEGIN;

CREATE SCHEMA quest;
REVOKE ALL ON SCHEMA quest FROM PUBLIC;

CREATE TABLE quest.environment_identity (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    network text NOT NULL CHECK (network = 'DEVNET'),
    genesis_hash text NOT NULL
        CHECK (genesis_hash = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),
    environment_id uuid NOT NULL,
    manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    namespace text NOT NULL CHECK (namespace = 'quest'),
    created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON quest.environment_identity FROM PUBLIC;

CREATE FUNCTION quest.reject_environment_identity_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Quest environment identity is immutable';
END;
$$;
CREATE TRIGGER environment_identity_immutable BEFORE UPDATE OR DELETE
    ON quest.environment_identity FOR EACH ROW
    EXECUTE FUNCTION quest.reject_environment_identity_change();

COMMIT;
