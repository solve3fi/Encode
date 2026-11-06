-- Dormant atomic LP/NFT full-range evidence and trust; no runtime grants.
BEGIN;
CREATE TABLE quest.position_timeline_clocks (
 campaign_id text PRIMARY KEY REFERENCES quest.position_baseline_anchors(campaign_id),
 anchor_sha256 text NOT NULL CHECK(anchor_sha256 ~ '^[0-9a-f]{64}$'),
 clock_sha256 text NOT NULL CHECK(clock_sha256 ~ '^[0-9a-f]{64}$'),
 clock_bundle jsonb NOT NULL CHECK(jsonb_typeof(clock_bundle)='object' AND pg_column_size(clock_bundle)<=4096),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quest.position_timeline_ranges (
 campaign_id text NOT NULL REFERENCES quest.position_timeline_clocks(campaign_id),
 anchor_sha256 text NOT NULL CHECK(anchor_sha256 ~ '^[0-9a-f]{64}$'),
 decoder_version text NOT NULL CHECK(decoder_version='position-timeline-v1'),
 start_slot bigint NOT NULL CHECK(start_slot BETWEEN 1 AND 9007199254740990),
 end_slot bigint NOT NULL CHECK(end_slot BETWEEN start_slot AND LEAST(start_slot+255,9007199254740990)),
 bundle_sha256 text NOT NULL CHECK(bundle_sha256 ~ '^[0-9a-f]{64}$'),
 evidence_bundle jsonb NOT NULL CHECK(jsonb_typeof(evidence_bundle)='object' AND pg_column_size(evidence_bundle)<=4194304),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,start_slot)
);
CREATE TABLE quest.position_timeline_conflicts (
 campaign_id text NOT NULL REFERENCES quest.position_timeline_clocks(campaign_id),
 start_slot bigint NOT NULL CHECK(start_slot BETWEEN 1 AND 9007199254740990),
 end_slot bigint NOT NULL CHECK(end_slot BETWEEN start_slot AND LEAST(start_slot+255,9007199254740990)),
 expected_sha256 text NOT NULL CHECK(expected_sha256 ~ '^[0-9a-f]{64}$'),
 observed_sha256 text NOT NULL CHECK(observed_sha256 ~ '^[0-9a-f]{64}$'),
 reason_code text NOT NULL CHECK(reason_code IN ('CHANGED_RANGE','LEGACY_SOURCE_CONFLICT','CHANGED_CLOCK')),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,start_slot,end_slot,reason_code,expected_sha256,observed_sha256)
);
CREATE TABLE quest.position_timeline_coverage (
 campaign_id text PRIMARY KEY REFERENCES quest.position_timeline_clocks(campaign_id),
 anchor_sha256 text NOT NULL CHECK(anchor_sha256 ~ '^[0-9a-f]{64}$'),
 decoder_version text NOT NULL CHECK(decoder_version='position-timeline-v1'),
 start_slot bigint NOT NULL CHECK(start_slot BETWEEN 1 AND 9007199254740990),
 covered_through_slot bigint CHECK(covered_through_slot BETWEEN start_slot AND 9007199254740990),
 last_range_start bigint,
 last_range_sha256 text CHECK(last_range_sha256 ~ '^[0-9a-f]{64}$'),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 invalidation_reason text CHECK(invalidation_reason IN ('LATE_EVIDENCE','CONFLICT')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((covered_through_slot IS NULL AND last_range_start IS NULL AND last_range_sha256 IS NULL)
 OR (covered_through_slot IS NOT NULL AND last_range_start IS NOT NULL AND last_range_start BETWEEN start_slot AND covered_through_slot AND last_range_sha256 IS NOT NULL AND invalidation_reason IS NULL))
);
REVOKE ALL ON quest.position_timeline_clocks,quest.position_timeline_ranges,quest.position_timeline_conflicts,quest.position_timeline_coverage FROM PUBLIC;

CREATE FUNCTION quest.guard_position_timeline_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a quest.position_baseline_anchors%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61746));
 SELECT * INTO a FROM quest.position_baseline_anchors WHERE campaign_id=NEW.campaign_id;
 IF a.campaign_id IS NULL THEN RAISE EXCEPTION 'Timeline anchor missing'; END IF;
 IF TG_TABLE_NAME='position_timeline_clocks' THEN
  IF NEW.anchor_sha256<>a.evidence_set_sha256 OR NEW.clock_bundle->>'clockSha256' IS DISTINCT FROM NEW.clock_sha256
   OR NOT NEW.clock_bundle @> jsonb_build_object('campaignId',a.campaign_id,'network',a.network,'manifestSha256',a.manifest_sha256,'anchorSlot',a.anchor_slot,'schemaVersion',1,'finality','finalized') THEN
   RAISE EXCEPTION 'Timeline clock pins differ'; END IF;
 ELSIF TG_TABLE_NAME='position_timeline_ranges' THEN
  IF NEW.anchor_sha256<>a.evidence_set_sha256 OR NEW.start_slot<=a.anchor_slot
   OR NOT NEW.evidence_bundle @> jsonb_build_object('campaignId',a.campaign_id,'network',a.network,'programId',a.program_id,'anchorSha256',NEW.anchor_sha256,'decoderVersion',NEW.decoder_version,'startSlot',NEW.start_slot,'endSlot',NEW.end_slot,'bundleSha256',NEW.bundle_sha256,'schemaVersion',1,'awardEligible',false,'state','TEST_ONLY_POSITION_TIMELINE_RANGE') THEN
   RAISE EXCEPTION 'Timeline range pins differ'; END IF;
  IF EXISTS(SELECT 1 FROM quest.position_timeline_ranges r WHERE r.campaign_id=NEW.campaign_id AND r.start_slot<>NEW.start_slot AND r.start_slot<=NEW.end_slot AND r.end_slot>=NEW.start_slot) THEN
   RAISE EXCEPTION 'Timeline ranges overlap'; END IF;
 ELSE
  IF NEW.start_slot<=a.anchor_slot THEN RAISE EXCEPTION 'Timeline conflict bounds differ'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER timeline_clock_guard BEFORE INSERT ON quest.position_timeline_clocks FOR EACH ROW EXECUTE FUNCTION quest.guard_position_timeline_evidence();
CREATE TRIGGER timeline_range_guard BEFORE INSERT ON quest.position_timeline_ranges FOR EACH ROW EXECUTE FUNCTION quest.guard_position_timeline_evidence();
CREATE TRIGGER timeline_conflict_guard BEFORE INSERT ON quest.position_timeline_conflicts FOR EACH ROW EXECUTE FUNCTION quest.guard_position_timeline_evidence();

CREATE FUNCTION quest.guard_position_timeline_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61746));
 IF NOT EXISTS(SELECT 1 FROM quest.position_baseline_anchors a WHERE a.campaign_id=NEW.campaign_id AND a.evidence_set_sha256=NEW.anchor_sha256 AND NEW.start_slot=a.anchor_slot+1) THEN RAISE EXCEPTION 'Timeline coverage anchor differs'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.covered_through_slot IS NOT NULL OR NEW.revision<>0 OR NEW.invalidation_reason IS NOT NULL THEN RAISE EXCEPTION 'Timeline coverage starts unpublished'; END IF;
 ELSE
  IF ROW(NEW.campaign_id,NEW.anchor_sha256,NEW.decoder_version,NEW.start_slot) IS DISTINCT FROM ROW(OLD.campaign_id,OLD.anchor_sha256,OLD.decoder_version,OLD.start_slot) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Timeline coverage pins or revision differ'; END IF;
  IF NEW.covered_through_slot IS NULL THEN
   IF OLD.covered_through_slot IS NULL OR NEW.invalidation_reason IS NULL THEN RAISE EXCEPTION 'Timeline invalidation differs'; END IF;
  ELSIF NEW.last_range_start<>COALESCE(OLD.covered_through_slot+1,OLD.start_slot)
   OR EXISTS(SELECT 1 FROM quest.position_timeline_conflicts c WHERE c.campaign_id=NEW.campaign_id)
   OR EXISTS(SELECT 1 FROM quest.position_ownership_conflicts c WHERE c.campaign_id=NEW.campaign_id)
   OR NOT EXISTS(SELECT 1 FROM quest.position_timeline_ranges r WHERE r.campaign_id=NEW.campaign_id AND r.start_slot=NEW.last_range_start AND r.end_slot=NEW.covered_through_slot AND r.bundle_sha256=NEW.last_range_sha256) THEN
   RAISE EXCEPTION 'Timeline coverage gap, missing range or quarantine';
  END IF;
 END IF;
 NEW.updated_at=now();RETURN NEW;
END;
$$;
CREATE TRIGGER timeline_coverage_guard BEFORE INSERT OR UPDATE ON quest.position_timeline_coverage FOR EACH ROW EXECUTE FUNCTION quest.guard_position_timeline_coverage();

CREATE FUNCTION quest.invalidate_position_timeline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE target_slot bigint;
BEGIN
 IF TG_TABLE_NAME='position_ownership_evidence' THEN target_slot=NEW.slot; ELSE target_slot=NULL; END IF;
 UPDATE quest.position_timeline_coverage SET covered_through_slot=NULL,last_range_start=NULL,last_range_sha256=NULL,revision=revision+1,invalidation_reason=CASE WHEN target_slot IS NULL THEN 'CONFLICT' ELSE 'LATE_EVIDENCE' END
 WHERE campaign_id=NEW.campaign_id AND covered_through_slot IS NOT NULL AND (target_slot IS NULL OR target_slot<=covered_through_slot);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.invalidate_position_timeline() FROM PUBLIC;
CREATE TRIGGER timeline_conflict_invalidation AFTER INSERT ON quest.position_timeline_conflicts FOR EACH ROW EXECUTE FUNCTION quest.invalidate_position_timeline();
CREATE TRIGGER timeline_legacy_conflict_invalidation AFTER INSERT ON quest.position_ownership_conflicts FOR EACH ROW EXECUTE FUNCTION quest.invalidate_position_timeline();
CREATE TRIGGER timeline_legacy_late_invalidation AFTER INSERT ON quest.position_ownership_evidence FOR EACH ROW EXECUTE FUNCTION quest.invalidate_position_timeline();

CREATE TRIGGER timeline_clocks_no_update_delete BEFORE UPDATE OR DELETE ON quest.position_timeline_clocks FOR EACH ROW EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER timeline_clocks_no_truncate BEFORE TRUNCATE ON quest.position_timeline_clocks FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER timeline_ranges_no_update_delete BEFORE UPDATE OR DELETE ON quest.position_timeline_ranges FOR EACH ROW EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER timeline_ranges_no_truncate BEFORE TRUNCATE ON quest.position_timeline_ranges FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER timeline_conflicts_no_update_delete BEFORE UPDATE OR DELETE ON quest.position_timeline_conflicts FOR EACH ROW EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER timeline_conflicts_no_truncate BEFORE TRUNCATE ON quest.position_timeline_conflicts FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER timeline_coverage_no_delete BEFORE DELETE ON quest.position_timeline_coverage FOR EACH ROW EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER timeline_coverage_no_truncate BEFORE TRUNCATE ON quest.position_timeline_coverage FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_position_ownership_change();
COMMIT;
