-- Dormant selected-inventory prefix trust. Runtime publication requires fresh RPC comparison.
BEGIN;
CREATE TABLE quest.position_ownership_coverage (
    campaign_id text PRIMARY KEY REFERENCES quest.position_baseline_anchors(campaign_id),
    anchor_sha256 text NOT NULL CHECK (anchor_sha256 ~ '^[0-9a-f]{64}$'),
    decoder_version text NOT NULL CHECK (decoder_version='position-ownership-v1'),
    start_slot bigint NOT NULL CHECK (start_slot BETWEEN 1 AND 9007199254740991),
    covered_through_slot bigint CHECK (covered_through_slot BETWEEN start_slot AND 9007199254740990),
    last_range_start bigint,
    last_range_end bigint,
    last_range_sha256 text CHECK (last_range_sha256 ~ '^[0-9a-f]{64}$'),
    last_stored_sha256 text CHECK (last_stored_sha256 ~ '^[0-9a-f]{64}$'),
    last_produced_slot bigint,
    last_block_hash text CHECK (last_block_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
    invalidation_reason text CHECK (invalidation_reason IN ('LATE_EVIDENCE','CONFLICT')),
    invalidated_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((covered_through_slot IS NULL AND last_range_start IS NULL AND last_range_end IS NULL
        AND last_range_sha256 IS NULL AND last_stored_sha256 IS NULL AND last_produced_slot IS NULL AND last_block_hash IS NULL)
        OR (covered_through_slot IS NOT NULL AND last_range_start IS NOT NULL AND last_range_end IS NOT NULL AND last_range_end=covered_through_slot
            AND last_range_start>=start_slot AND last_range_end BETWEEN last_range_start AND last_range_start+255
            AND last_range_sha256 IS NOT NULL AND last_stored_sha256 IS NOT NULL AND invalidation_reason IS NULL)),
    CHECK ((last_produced_slot IS NULL AND last_block_hash IS NULL)
        OR (last_produced_slot IS NOT NULL AND last_produced_slot BETWEEN start_slot AND covered_through_slot AND last_block_hash IS NOT NULL))
);
REVOKE ALL ON quest.position_ownership_coverage FROM PUBLIC;
CREATE FUNCTION quest.guard_position_ownership_coverage() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61746));
    IF NOT EXISTS (SELECT 1 FROM quest.position_baseline_anchors a WHERE a.campaign_id=NEW.campaign_id
        AND a.evidence_set_sha256=NEW.anchor_sha256 AND NEW.start_slot=a.anchor_slot+1) THEN
        RAISE EXCEPTION 'Position ownership coverage anchor differs';
    END IF;
    IF TG_OP='INSERT' THEN
        IF NEW.covered_through_slot IS NOT NULL OR NEW.revision<>0 OR NEW.invalidation_reason IS NOT NULL THEN
            RAISE EXCEPTION 'Position ownership coverage starts unpublished';
        END IF;
    ELSE
        IF ROW(NEW.campaign_id,NEW.anchor_sha256,NEW.decoder_version,NEW.start_slot)
            IS DISTINCT FROM ROW(OLD.campaign_id,OLD.anchor_sha256,OLD.decoder_version,OLD.start_slot)
            OR NEW.revision<>OLD.revision+1 THEN
            RAISE EXCEPTION 'Position ownership coverage pins or revision differ';
        END IF;
        IF NEW.covered_through_slot IS NULL THEN
            IF OLD.covered_through_slot IS NULL OR NEW.invalidation_reason IS NULL THEN
                RAISE EXCEPTION 'Position ownership coverage invalidation differs';
            END IF;
            NEW.invalidated_at=now();
        ELSE
            IF NEW.last_range_start<>COALESCE(OLD.covered_through_slot+1,OLD.start_slot)
                OR NEW.last_range_end<>NEW.covered_through_slot
                OR EXISTS (SELECT 1 FROM quest.position_ownership_conflicts c WHERE c.campaign_id=NEW.campaign_id)
                OR (OLD.last_produced_slot IS NOT NULL AND (NEW.last_produced_slot IS NULL OR NEW.last_produced_slot<OLD.last_produced_slot))
                OR (NEW.last_produced_slot IS DISTINCT FROM OLD.last_produced_slot
                    AND NEW.last_produced_slot NOT BETWEEN NEW.last_range_start AND NEW.last_range_end)
                OR (NEW.last_produced_slot IS NOT DISTINCT FROM OLD.last_produced_slot
                    AND NEW.last_block_hash IS DISTINCT FROM OLD.last_block_hash) THEN
                RAISE EXCEPTION 'Position ownership coverage gap, conflict or block identity differs';
            END IF;
        END IF;
    END IF;
    NEW.updated_at=now();
    RETURN NEW;
END;
$$;
CREATE TRIGGER position_ownership_coverage_guard BEFORE INSERT OR UPDATE ON quest.position_ownership_coverage
    FOR EACH ROW EXECUTE FUNCTION quest.guard_position_ownership_coverage();
CREATE TRIGGER position_ownership_coverage_no_delete BEFORE DELETE ON quest.position_ownership_coverage
    FOR EACH ROW EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER position_ownership_coverage_no_truncate BEFORE TRUNCATE ON quest.position_ownership_coverage
    FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_position_ownership_change();
-- A source/conflict insert-only role can invalidate without receiving publication UPDATE grants.
-- Fixed qualified objects and fixed search path; this function can only clear trust.
CREATE FUNCTION quest.invalidate_position_ownership_coverage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE target_slot bigint;
BEGIN
    IF TG_TABLE_NAME='position_ownership_conflicts' THEN target_slot=NULL;
    ELSE target_slot=NEW.slot;
    END IF;
    UPDATE quest.position_ownership_coverage SET
        covered_through_slot=NULL,last_range_start=NULL,last_range_end=NULL,last_range_sha256=NULL,last_stored_sha256=NULL,
        last_produced_slot=NULL,last_block_hash=NULL,revision=revision+1,
        invalidation_reason=CASE WHEN TG_TABLE_NAME='position_ownership_conflicts' THEN 'CONFLICT' ELSE 'LATE_EVIDENCE' END
    WHERE campaign_id=NEW.campaign_id AND covered_through_slot IS NOT NULL
        AND (target_slot IS NULL OR target_slot<=covered_through_slot);
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.invalidate_position_ownership_coverage() FROM PUBLIC;
CREATE TRIGGER position_ownership_late_evidence AFTER INSERT ON quest.position_ownership_evidence
    FOR EACH ROW EXECUTE FUNCTION quest.invalidate_position_ownership_coverage();
CREATE TRIGGER position_ownership_conflict_invalidation AFTER INSERT ON quest.position_ownership_conflicts
    FOR EACH ROW EXECUTE FUNCTION quest.invalidate_position_ownership_coverage();
COMMIT;
