-- Opt-in synthetic monthly reservations. No XP events or runtime grants.
BEGIN;
CREATE TABLE quest.community_test_policies (
 campaign_id text PRIMARY KEY REFERENCES quest.calendar_plans(campaign_id),
 document jsonb NOT NULL
);
CREATE TABLE quest.community_test_reservations (
 campaign_id text NOT NULL,
 goal_id text NOT NULL,
 month_start date NOT NULL,
 recipient_count integer NOT NULL CHECK(recipient_count BETWEEN 0 AND 20000),
 per_recipient_test_xp integer NOT NULL CHECK(per_recipient_test_xp BETWEEN 1 AND 1000000),
 total_test_xp bigint NOT NULL CHECK(total_test_xp=recipient_count::bigint*per_recipient_test_xp),
 receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 award_eligible boolean NOT NULL DEFAULT false CHECK(award_eligible=false),
 PRIMARY KEY(campaign_id,goal_id),
 FOREIGN KEY(campaign_id,goal_id) REFERENCES quest.calendar_milestones(campaign_id,goal_id)
);
CREATE FUNCTION quest.guard_community_test_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Community test writes require read committed isolation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61748));
 IF EXISTS(SELECT 1 FROM quest.calendar_milestones WHERE campaign_id=NEW.campaign_id) THEN
  RAISE EXCEPTION 'Community test policy must precede all milestones';
 END IF;
 IF (jsonb_typeof(NEW.document)='object' AND NEW.document->>'network'='DEVNET'
 AND NEW.document->>'fixtureKind'='SYNTHETIC_DEVNET'
 AND jsonb_typeof(NEW.document->'revision')='number' AND NEW.document->>'revision'='1') IS NOT TRUE
 OR (SELECT count(*) FROM jsonb_object_keys(NEW.document))<>5 THEN
  RAISE EXCEPTION 'Invalid synthetic community policy';
 END IF;
 FOREACH k IN ARRAY ARRAY['perCampaignMonthXp','perCampaignYearXp'] LOOP
  IF (jsonb_typeof(NEW.document->k)='string' AND NEW.document->>k ~ '^[1-9][0-9]{0,14}$') IS NOT TRUE THEN
   RAISE EXCEPTION 'Invalid synthetic community ceiling';
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
-- Take the campaign lock BEFORE unique-row insertion. An AFTER-only lock can
-- deadlock a direct SQL insert against a store writer holding this lock first.
-- Require RC even without policy: an old RR snapshot must not hide a new policy.
CREATE FUNCTION quest.lock_community_test_milestone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Community test writes require read committed isolation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61748));
 RETURN NEW;
END;
$$;
-- Only this milestone trigger inserts reservations. The serving role needs no
-- INSERT privilege on the reservation table, policy table or XP ledger.
CREATE FUNCTION quest.reserve_community_test_budget() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE policy jsonb; plan jsonb; goal jsonb; cutoff timestamptz;
 selected_clock timestamptz; expected_audience jsonb; n bigint;
 month_date date; amount bigint; month_used numeric; year_used numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61748));
 SELECT document INTO policy FROM quest.community_test_policies WHERE campaign_id=NEW.campaign_id;
 -- Older explicitly unbudgeted fixtures remain readable. No retroactive policy.
 IF policy IS NULL THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Community test writes require read committed isolation';
 END IF;
 SELECT document INTO plan FROM (
  SELECT document,1 AS revision FROM quest.calendar_plans WHERE campaign_id=NEW.campaign_id
  UNION ALL SELECT document,revision FROM quest.calendar_plan_revisions WHERE campaign_id=NEW.campaign_id
 ) versions ORDER BY revision DESC LIMIT 1;
 SELECT value INTO goal FROM jsonb_array_elements(plan->'communityGoals') WHERE value->>'id'=NEW.goal_id;
 selected_clock=clock_timestamp();
 cutoff=(NEW.document->>'audienceCutoff')::timestamptz;
 IF (goal IS NOT NULL AND cutoff IS NOT NULL
 AND cutoff>=(goal->>'startsAt')::timestamptz AND cutoff<(goal->>'endsAt')::timestamptz
 AND selected_clock>=(goal->>'startsAt')::timestamptz AND selected_clock<(goal->>'endsAt')::timestamptz
 AND cutoff<=selected_clock AND cutoff>=selected_clock-make_interval(secs=>least(300,(goal->>'maxAgeSeconds')::integer))
 AND NEW.document->'awardEligible'='false'::jsonb AND NEW.document->'reached'='true'::jsonb
 AND NEW.document->'proof'->>'fixtureKind'='SYNTHETIC_DEVNET' AND NEW.document->'proof'->>'network'='DEVNET'
 AND (NEW.document->'proof'->>'observedAt')::timestamptz=cutoff
 AND NEW.document->'proof'->>'valuationVersion'=goal->>'valuationVersion'
 AND NEW.document->'proof'->>'manifestSha256'=(SELECT manifest_sha256 FROM quest.environment_identity WHERE singleton=true)
 AND jsonb_typeof(NEW.document->'observedTvlUsdCents')='string'
 AND NEW.document->>'observedTvlUsdCents' ~ '^(0|[1-9][0-9]{0,37})$'
 AND (NEW.document->>'observedTvlUsdCents')::numeric>=(goal->>'targetUsdCents')::numeric) IS NOT TRUE THEN
  RAISE EXCEPTION 'Community test milestone expired or differs';
 END IF;
 month_date=date_trunc('month',(goal->>'startsAt')::timestamptz AT TIME ZONE 'UTC')::date;
 -- A goal belongs to one UTC month. Partial-month windows are allowed.
 IF (goal->>'endsAt')::timestamptz>(month_date+interval '1 month') AT TIME ZONE 'UTC' THEN
  RAISE EXCEPTION 'Budgeted community goal crosses month boundary';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'passportId',passport_id::text,'state','PENDING_TEST_ONLY','testXp',(goal->>'testXp')::integer,
  'entitlementKey',encode(sha256(convert_to(format('["community","%s","%s","%s"]',NEW.campaign_id,NEW.goal_id,passport_id),'UTF8')),'hex')) ORDER BY passport_id),'[]'::jsonb)
 INTO expected_audience FROM (SELECT passport_id FROM quest.passports WHERE network='DEVNET' AND created_at<=cutoff ORDER BY passport_id LIMIT 20001) audience;
 n=jsonb_array_length(expected_audience);
 IF n>20000 THEN RAISE EXCEPTION 'Complete bounded community audience required'; END IF;
 IF NEW.document->'entitlements' IS DISTINCT FROM expected_audience THEN
  RAISE EXCEPTION 'Community test audience differs';
 END IF;
 amount=n*(goal->>'testXp')::bigint;
 SELECT coalesce(sum(total_test_xp),0),coalesce(sum(total_test_xp) FILTER(WHERE month_start=month_date),0)
 INTO year_used,month_used FROM quest.community_test_reservations WHERE campaign_id=NEW.campaign_id;
 IF month_used+amount>(policy->>'perCampaignMonthXp')::numeric
 OR year_used+amount>(policy->>'perCampaignYearXp')::numeric THEN
  RAISE EXCEPTION 'Community test budget exceeded';
 END IF;
 INSERT INTO quest.community_test_reservations(campaign_id,goal_id,month_start,recipient_count,per_recipient_test_xp,total_test_xp,receipt_sha256)
 VALUES(NEW.campaign_id,NEW.goal_id,month_date,n,(goal->>'testXp')::integer,amount,NEW.receipt_sha256);
 RETURN NEW;
END;
$$;
CREATE TRIGGER community_policy_guard BEFORE INSERT ON quest.community_test_policies
 FOR EACH ROW EXECUTE FUNCTION quest.guard_community_test_policy();
CREATE TRIGGER community_milestone_lock BEFORE INSERT ON quest.calendar_milestones
 FOR EACH ROW EXECUTE FUNCTION quest.lock_community_test_milestone();
CREATE TRIGGER community_budget_reserve AFTER INSERT ON quest.calendar_milestones
 FOR EACH ROW EXECUTE FUNCTION quest.reserve_community_test_budget();
CREATE TRIGGER community_policy_immutable BEFORE UPDATE OR DELETE ON quest.community_test_policies
 FOR EACH ROW EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER community_reservation_immutable BEFORE UPDATE OR DELETE ON quest.community_test_reservations
 FOR EACH ROW EXECUTE FUNCTION quest.reject_calendar_change();
-- Prevent a privileged test writer from resetting append-only ceilings/history.
CREATE TRIGGER community_policy_no_truncate BEFORE TRUNCATE ON quest.community_test_policies
 FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER community_reservation_no_truncate BEFORE TRUNCATE ON quest.community_test_reservations
 FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER weekly_policy_no_truncate BEFORE TRUNCATE ON quest.weekly_test_policies
 FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER weekly_receipt_no_truncate BEFORE TRUNCATE ON quest.weekly_test_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER calendar_milestone_no_truncate BEFORE TRUNCATE ON quest.calendar_milestones
 FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER calendar_plan_no_truncate BEFORE TRUNCATE ON quest.calendar_plans
 FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER calendar_revision_no_truncate BEFORE TRUNCATE ON quest.calendar_plan_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_calendar_change();
CREATE INDEX weekly_test_personal_history ON quest.weekly_test_receipts(campaign_id,passport_id,starts_at DESC,slot DESC);
REVOKE ALL ON quest.community_test_policies,quest.community_test_reservations FROM PUBLIC;
REVOKE ALL ON FUNCTION quest.guard_community_test_policy(),quest.lock_community_test_milestone(),quest.reserve_community_test_budget() FROM PUBLIC;
COMMIT;
