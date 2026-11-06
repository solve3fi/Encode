-- Dormant Devnet point-in-time evidence storage. No runtime grants or collector.
-- Apply after 004. A provisioned immutable environment identity is required
-- before inserts. Selected inventory is NOT proof of all campaign positions.
BEGIN;
CREATE TABLE quest.position_baseline_anchors (
    campaign_id text PRIMARY KEY CHECK (length(campaign_id) BETWEEN 1 AND 128),
    environment_singleton boolean NOT NULL DEFAULT true CHECK (environment_singleton)
        REFERENCES quest.environment_identity(singleton),
    network text NOT NULL CHECK (network = 'DEVNET'),
    program_id text NOT NULL CHECK (program_id ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
    layout_version text NOT NULL CHECK (layout_version = 'solve-position-v1'),
    anchor_slot bigint NOT NULL CHECK (anchor_slot BETWEEN 0 AND 9007199254740990),
    manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
    inventory_sha256 text NOT NULL CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$'),
    evidence_set_sha256 text NOT NULL CHECK (evidence_set_sha256 ~ '^[0-9a-f]{64}$'),
    position_count integer NOT NULL CHECK (position_count BETWEEN 1 AND 256),
    evidence_bundle jsonb NOT NULL CHECK (jsonb_typeof(evidence_bundle) = 'object'
        AND octet_length(evidence_bundle::text) <= 1048576),
    recorded_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON quest.position_baseline_anchors FROM PUBLIC;
CREATE FUNCTION quest.check_position_baseline_environment() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM quest.environment_identity
        WHERE singleton AND network = NEW.network
          AND manifest_sha256 = NEW.manifest_sha256) THEN
        RAISE EXCEPTION 'Position baseline environment pins differ';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER position_baseline_environment BEFORE INSERT
    ON quest.position_baseline_anchors FOR EACH ROW
    EXECUTE FUNCTION quest.check_position_baseline_environment();
CREATE FUNCTION quest.reject_position_baseline_anchor_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Position baseline anchor is immutable';
END;
$$;
CREATE TRIGGER position_baseline_anchor_immutable BEFORE UPDATE OR DELETE
    ON quest.position_baseline_anchors FOR EACH ROW
    EXECUTE FUNCTION quest.reject_position_baseline_anchor_change();
CREATE TRIGGER position_baseline_anchor_no_truncate BEFORE TRUNCATE
    ON quest.position_baseline_anchors FOR EACH STATEMENT
    EXECUTE FUNCTION quest.reject_position_baseline_anchor_change();
COMMIT;
