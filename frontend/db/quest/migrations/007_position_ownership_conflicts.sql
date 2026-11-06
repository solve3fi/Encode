-- Dormant durable quarantine. No publication watermark or resolution automation.
BEGIN;
CREATE TABLE quest.position_ownership_conflicts (
    campaign_id text NOT NULL REFERENCES quest.position_baseline_anchors(campaign_id),
    anchor_sha256 text NOT NULL CHECK (anchor_sha256 ~ '^[0-9a-f]{64}$'),
    decoder_version text NOT NULL CHECK (decoder_version='position-ownership-v1'),
    start_slot bigint NOT NULL CHECK (start_slot BETWEEN 0 AND 9007199254740990),
    end_slot bigint NOT NULL CHECK (end_slot BETWEEN start_slot AND start_slot+255 AND end_slot<=9007199254740990),
    reason_code text NOT NULL CHECK (reason_code IN ('MISSING_SOURCE','EXTRA_SOURCE','CHANGED_SOURCE')),
    observed_range_sha256 text NOT NULL CHECK (observed_range_sha256 ~ '^[0-9a-f]{64}$'),
    stored_range_sha256 text NOT NULL CHECK (stored_range_sha256 ~ '^[0-9a-f]{64}$'),
    observed_count integer NOT NULL CHECK (observed_count BETWEEN 0 AND 4096),
    stored_count integer NOT NULL CHECK (stored_count BETWEEN 0 AND 4096),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(campaign_id,start_slot,end_slot,reason_code,observed_range_sha256,stored_range_sha256)
);
REVOKE ALL ON quest.position_ownership_conflicts FROM PUBLIC;
CREATE FUNCTION quest.check_position_ownership_conflict_anchor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61746));
    IF NOT EXISTS (SELECT 1 FROM quest.position_baseline_anchors a
        WHERE a.campaign_id=NEW.campaign_id AND a.evidence_set_sha256=NEW.anchor_sha256
          AND NEW.start_slot>a.anchor_slot) THEN
        RAISE EXCEPTION 'Position ownership conflict anchor differs';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER position_ownership_conflict_anchor BEFORE INSERT ON quest.position_ownership_conflicts
    FOR EACH ROW EXECUTE FUNCTION quest.check_position_ownership_conflict_anchor();
CREATE TRIGGER position_ownership_conflict_immutable BEFORE UPDATE OR DELETE ON quest.position_ownership_conflicts
    FOR EACH ROW EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER position_ownership_conflict_no_truncate BEFORE TRUNCATE ON quest.position_ownership_conflicts
    FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_position_ownership_change();
COMMIT;
