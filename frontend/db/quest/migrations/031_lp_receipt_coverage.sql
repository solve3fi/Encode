BEGIN;
-- Hold the publisher/invalidation lock through receipt commit, then recheck
-- exactly the coverage revision used by the historical ownership reader.
CREATE FUNCTION quest.lock_lp_test_source(p_campaign text,p_anchor text,p_revision bigint,p_end bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'LP receipt coverage requires a fresh read-committed transaction';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign,61746));
 RETURN EXISTS(SELECT 1 FROM quest.position_timeline_coverage c
  WHERE c.campaign_id=p_campaign AND c.anchor_sha256=p_anchor AND c.revision=p_revision
   AND c.invalidation_reason IS NULL AND c.covered_through_slot>=p_end)
  AND NOT EXISTS(SELECT 1 FROM quest.position_timeline_conflicts WHERE campaign_id=p_campaign)
  AND NOT EXISTS(SELECT 1 FROM quest.position_ownership_conflicts WHERE campaign_id=p_campaign);
END $$;
REVOKE ALL ON FUNCTION quest.lock_lp_test_source(text,text,bigint,bigint) FROM PUBLIC;
COMMIT;
