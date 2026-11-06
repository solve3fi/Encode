-- Dormant synthetic Devnet calendars. No XP writes, routes or runtime grants.
BEGIN;
CREATE TABLE quest.calendar_plans (
 campaign_id text PRIMARY KEY CHECK(campaign_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
 plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^[a-f0-9]{64}$'),
 document jsonb NOT NULL CHECK((jsonb_typeof(document)='object'
  AND document->>'network'='DEVNET'
  AND document->>'fixtureKind'='SYNTHETIC_DEVNET'
  AND document->>'timezone'='UTC'
  AND document->>'campaignId'=campaign_id) IS TRUE),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE quest.calendar_milestones (
 campaign_id text NOT NULL REFERENCES quest.calendar_plans(campaign_id),
 goal_id text NOT NULL CHECK(goal_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 document jsonb NOT NULL CHECK((jsonb_typeof(document)='object'
  AND document->>'campaignId'=campaign_id
  AND document->>'goalId'=goal_id
  AND document->>'awardEligible'='false'
  AND document->>'reached'='true'
  AND jsonb_typeof(document->'entitlements')='array') IS TRUE),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,goal_id)
);
CREATE TABLE quest.calendar_plan_revisions (
 campaign_id text NOT NULL REFERENCES quest.calendar_plans(campaign_id),
 revision integer NOT NULL CHECK(revision BETWEEN 2 AND 10000),
 previous_sha256 text NOT NULL CHECK(previous_sha256 ~ '^[a-f0-9]{64}$'),
 plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^[a-f0-9]{64}$'),
 document jsonb NOT NULL CHECK((jsonb_typeof(document)='object'
  AND document->>'network'='DEVNET'
  AND document->>'fixtureKind'='SYNTHETIC_DEVNET'
  AND document->>'timezone'='UTC'
  AND document->>'campaignId'=campaign_id) IS TRUE),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,revision)
);
CREATE FUNCTION quest.reject_calendar_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published calendar and milestone history are immutable'; END;
$$;
CREATE FUNCTION quest.guard_calendar_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_doc jsonb; previous_hash text; previous_revision integer;
 old_week jsonb; new_week jsonb; old_goal jsonb; new_goal jsonb;
 quest_id text; selected_clock timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61748));
 SELECT document,plan_sha256,revision INTO previous_doc,previous_hash,previous_revision
 FROM (SELECT document,plan_sha256,1 AS revision FROM quest.calendar_plans WHERE campaign_id=NEW.campaign_id
 UNION ALL SELECT document,plan_sha256,revision FROM quest.calendar_plan_revisions WHERE campaign_id=NEW.campaign_id)
 versions ORDER BY revision DESC LIMIT 1;
 IF previous_doc IS NULL OR NEW.revision<>previous_revision+1 OR NEW.previous_sha256<>previous_hash THEN
  RAISE EXCEPTION 'Calendar revision conflict';
 END IF;
 IF NEW.document->'startsOn' IS DISTINCT FROM previous_doc->'startsOn'
 OR NEW.document->'weekCount' IS DISTINCT FROM previous_doc->'weekCount'
 OR jsonb_array_length(NEW.document->'weeks') IS DISTINCT FROM jsonb_array_length(previous_doc->'weeks') THEN
  RAISE EXCEPTION 'Calendar horizon cannot change';
 END IF;
 selected_clock=clock_timestamp();
 FOR old_week IN SELECT value FROM jsonb_array_elements(previous_doc->'weeks') LOOP
  IF ((old_week->>'startsOn')||'T00:00:00Z')::timestamptz<=selected_clock THEN
   SELECT value INTO new_week FROM jsonb_array_elements(NEW.document->'weeks') WHERE value->>'startsOn'=old_week->>'startsOn';
   IF old_week IS DISTINCT FROM new_week THEN RAISE EXCEPTION 'Started weekly quests cannot change'; END IF;
   FOR quest_id IN SELECT jsonb_array_elements_text(old_week->'questIds') LOOP
    IF (SELECT value FROM jsonb_array_elements(previous_doc->'templates') WHERE value->>'id'=quest_id)
    IS DISTINCT FROM (SELECT value FROM jsonb_array_elements(NEW.document->'templates') WHERE value->>'id'=quest_id) THEN
     RAISE EXCEPTION 'Started quest template cannot change';
    END IF;
   END LOOP;
  END IF;
 END LOOP;
 FOR old_goal IN SELECT value FROM jsonb_array_elements(previous_doc->'communityGoals') LOOP
  IF (old_goal->>'startsAt')::timestamptz<=selected_clock THEN
   SELECT value INTO new_goal FROM jsonb_array_elements(NEW.document->'communityGoals') WHERE value->>'id'=old_goal->>'id';
   IF old_goal IS DISTINCT FROM new_goal THEN RAISE EXCEPTION 'Started community goal cannot change'; END IF;
  END IF;
 END LOOP;
 FOR new_goal IN SELECT value FROM jsonb_array_elements(NEW.document->'communityGoals') LOOP
  IF (new_goal->>'startsAt')::timestamptz<=selected_clock AND NOT EXISTS
   (SELECT 1 FROM jsonb_array_elements(previous_doc->'communityGoals') prior_goal
   WHERE prior_goal.value->>'id'=new_goal->>'id' AND (prior_goal.value->>'startsAt')::timestamptz<=selected_clock) THEN
   RAISE EXCEPTION 'Retroactive community goal forbidden';
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE TRIGGER calendar_revision_guard BEFORE INSERT ON quest.calendar_plan_revisions
 FOR EACH ROW EXECUTE FUNCTION quest.guard_calendar_revision();
CREATE TRIGGER calendar_plan_immutable BEFORE UPDATE OR DELETE ON quest.calendar_plans
 FOR EACH ROW EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER calendar_milestone_immutable BEFORE UPDATE OR DELETE ON quest.calendar_milestones
 FOR EACH ROW EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER calendar_revision_immutable BEFORE UPDATE OR DELETE ON quest.calendar_plan_revisions
 FOR EACH ROW EXECUTE FUNCTION quest.reject_calendar_change();
REVOKE ALL ON quest.calendar_plans,quest.calendar_milestones,quest.calendar_plan_revisions FROM PUBLIC;
REVOKE ALL ON FUNCTION quest.reject_calendar_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION quest.guard_calendar_revision() FROM PUBLIC;
COMMIT;
