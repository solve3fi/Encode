BEGIN;
-- New selected positions have independent immutable finalized baselines.
CREATE TABLE quest.lp_inventory_cohorts (
 parent_campaign_id text NOT NULL REFERENCES quest.position_baseline_anchors(campaign_id),
 cohort_campaign_id text PRIMARY KEY REFERENCES quest.position_baseline_anchors(campaign_id),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(parent_campaign_id<>cohort_campaign_id)
);
REVOKE ALL ON quest.lp_inventory_cohorts FROM PUBLIC;
CREATE FUNCTION quest.guard_lp_inventory_cohort() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent quest.position_baseline_anchors%ROWTYPE; cohort quest.position_baseline_anchors%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'LP admission requires read committed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lp-inventory-admission',61747));
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.parent_campaign_id,61746));
 SELECT * INTO parent FROM quest.position_baseline_anchors WHERE campaign_id=NEW.parent_campaign_id;
 SELECT * INTO cohort FROM quest.position_baseline_anchors WHERE campaign_id=NEW.cohort_campaign_id;
 IF parent.campaign_id IS NULL OR cohort.campaign_id IS NULL OR
  ROW(parent.network,parent.program_id,parent.layout_version,parent.manifest_sha256) IS DISTINCT FROM
  ROW(cohort.network,cohort.program_id,cohort.layout_version,cohort.manifest_sha256) OR cohort.anchor_slot<parent.anchor_slot OR cohort.position_count>32 THEN
  RAISE EXCEPTION 'LP admission pins or slot differ'; END IF;
 IF EXISTS(SELECT 1 FROM quest.lp_inventory_cohorts WHERE cohort_campaign_id=NEW.parent_campaign_id OR parent_campaign_id=NEW.cohort_campaign_id) THEN
  RAISE EXCEPTION 'LP admission nesting forbidden'; END IF;
 IF (SELECT count(*) FROM quest.lp_inventory_cohorts WHERE parent_campaign_id=NEW.parent_campaign_id)>=16 THEN
  RAISE EXCEPTION 'LP admission cohort bound exceeded'; END IF;
 IF EXISTS(SELECT 1 FROM quest.position_baseline_anchors a,
  jsonb_array_elements(a.evidence_bundle->'inventory') existing,
  jsonb_array_elements(cohort.evidence_bundle->'inventory') incoming
  WHERE (a.campaign_id=NEW.parent_campaign_id OR a.campaign_id IN
   (SELECT cohort_campaign_id FROM quest.lp_inventory_cohorts WHERE parent_campaign_id=NEW.parent_campaign_id))
  AND (existing->>'positionAddress'=incoming->>'positionAddress' OR existing->>'positionMint'=incoming->>'positionMint')) THEN
  RAISE EXCEPTION 'LP position or mint already admitted'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lp_inventory_cohort_guard BEFORE INSERT ON quest.lp_inventory_cohorts FOR EACH ROW EXECUTE FUNCTION quest.guard_lp_inventory_cohort();
CREATE TRIGGER lp_inventory_cohort_immutable BEFORE UPDATE OR DELETE ON quest.lp_inventory_cohorts FOR EACH ROW EXECUTE FUNCTION quest.reject_position_baseline_anchor_change();
CREATE TRIGGER lp_inventory_cohort_no_truncate BEFORE TRUNCATE ON quest.lp_inventory_cohorts FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_position_baseline_anchor_change();

CREATE FUNCTION quest.lock_lp_inventory_source(p_parent text,p_revision bigint,p_sources jsonb,p_end bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE supplied text[]; expected text[]; item jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'LP inventory receipt requires read committed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_parent,61746));
 IF jsonb_typeof(p_sources) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sources) NOT BETWEEN 1 AND 17 OR p_revision IS NULL OR p_end IS NULL THEN RETURN false; END IF;
 IF (SELECT count(*) FROM quest.lp_inventory_cohorts WHERE parent_campaign_id=p_parent)<>p_revision THEN RETURN false; END IF;
 SELECT array_agg(id ORDER BY id COLLATE "C") INTO expected FROM (
  SELECT campaign_id AS id FROM quest.position_baseline_anchors WHERE campaign_id=p_parent AND anchor_slot<p_end
  UNION ALL SELECT a.campaign_id FROM quest.lp_inventory_cohorts c JOIN quest.position_baseline_anchors a ON a.campaign_id=c.cohort_campaign_id
   WHERE c.parent_campaign_id=p_parent AND a.anchor_slot<p_end
 ) active;
 SELECT array_agg(e->>'campaignId' ORDER BY (e->>'campaignId') COLLATE "C") INTO supplied FROM jsonb_array_elements(p_sources) e;
 IF expected IS NULL OR supplied IS DISTINCT FROM expected THEN RETURN false; END IF;
 FOR item IN SELECT e FROM jsonb_array_elements(p_sources) e ORDER BY (e->>'campaignId') COLLATE "C" LOOP
  IF NOT quest.lock_lp_test_source(item->>'campaignId',item->>'anchorSha256',(item->>'coverageRevision')::bigint,p_end) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION quest.lock_lp_inventory_source(text,bigint,jsonb,bigint) FROM PUBLIC;
COMMIT;