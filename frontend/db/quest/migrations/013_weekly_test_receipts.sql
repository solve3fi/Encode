-- Dormant synthetic completion reservations. Never writes quest.xp_events.
BEGIN;
CREATE TABLE quest.weekly_test_policies (
 campaign_id text PRIMARY KEY REFERENCES quest.calendar_plans(campaign_id),
 document jsonb NOT NULL CHECK((jsonb_typeof(document)='object'
  AND document->>'fixtureKind'='SYNTHETIC_DEVNET' AND document->>'network'='DEVNET') IS TRUE)
);
-- Exact policy shape and integer arithmetic are checked in the trigger below.
CREATE TABLE quest.weekly_test_receipts (
 campaign_id text NOT NULL REFERENCES quest.weekly_test_policies(campaign_id),
 starts_at timestamptz NOT NULL,
 slot integer NOT NULL CHECK(slot BETWEEN 0 AND 2),
 network text NOT NULL DEFAULT 'DEVNET' CHECK(network='DEVNET'),
 passport_id uuid NOT NULL,
 instance_key text NOT NULL CHECK(instance_key ~ '^[a-f0-9]{64}$'),
 completion_key text NOT NULL UNIQUE CHECK(completion_key ~ '^[a-f0-9]{64}$'),
 test_xp integer NOT NULL CHECK(test_xp BETWEEN 1 AND 1000000),
 set_sha256 text NOT NULL CHECK(set_sha256 ~ '^[a-f0-9]{64}$'),
 facts_sha256 text NOT NULL CHECK(facts_sha256 ~ '^[a-f0-9]{64}$'),
 qualification_sha256 text NOT NULL CHECK(qualification_sha256 ~ '^[a-f0-9]{64}$'),
 source_captured_at timestamptz NOT NULL,
 fixture_kind text NOT NULL DEFAULT 'SYNTHETIC_DEVNET' CHECK(fixture_kind='SYNTHETIC_DEVNET'),
 award_eligible boolean NOT NULL DEFAULT false CHECK(award_eligible=false),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,starts_at,slot,passport_id),
 FOREIGN KEY(network,passport_id) REFERENCES quest.passports(network,passport_id)
);
CREATE FUNCTION quest.guard_weekly_test_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_key text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Weekly test writes require read committed isolation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61748));
 IF (SELECT count(*) FROM jsonb_object_keys(NEW.document))<>6
 OR (jsonb_typeof(NEW.document->'revision')='number'
 AND NEW.document->>'revision' ~ '^[1-9][0-9]{0,4}$'
 AND (NEW.document->>'revision')::integer<=10000) IS NOT TRUE THEN
  RAISE EXCEPTION 'Invalid synthetic weekly policy';
 END IF;
 FOREACH selected_key IN ARRAY ARRAY['perPassportEpochXp','perCampaignEpochXp','perCampaignYearXp'] LOOP
  IF (jsonb_typeof(NEW.document->selected_key)='string'
   AND NEW.document->>selected_key ~ '^[1-9][0-9]{0,14}$') IS NOT TRUE THEN
   RAISE EXCEPTION 'Invalid synthetic weekly ceiling';
  END IF;
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE FUNCTION quest.guard_weekly_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy jsonb; plan jsonb; selected_week jsonb; selected_template jsonb;
 selected_clock timestamptz; start_iso text; expected_instance text; expected_completion text;
 person_used numeric; epoch_used numeric; year_used numeric; history_count bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Weekly test writes require read committed isolation';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id,61748));
 SELECT document INTO policy FROM quest.weekly_test_policies WHERE campaign_id=NEW.campaign_id;
 SELECT document INTO plan FROM (
  SELECT document,1 AS revision FROM quest.calendar_plans WHERE campaign_id=NEW.campaign_id
  UNION ALL SELECT document,revision FROM quest.calendar_plan_revisions WHERE campaign_id=NEW.campaign_id
 ) versions ORDER BY revision DESC LIMIT 1;
 selected_clock=clock_timestamp();
 IF extract(isodow FROM NEW.starts_at AT TIME ZONE 'UTC')<>4
 OR NEW.starts_at<>date_trunc('day',NEW.starts_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
 OR NEW.starts_at>selected_clock OR NEW.starts_at+interval '168 hours'<=selected_clock
 OR NEW.source_captured_at>selected_clock
 OR NEW.source_captured_at<selected_clock-interval '5 minutes'
 OR NEW.source_captured_at<NEW.starts_at THEN
  RAISE EXCEPTION 'Weekly test receipt expired or stale';
 END IF;
 start_iso=to_char(NEW.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 SELECT value INTO selected_week FROM jsonb_array_elements(plan->'weeks')
 WHERE value->>'startsOn'=left(start_iso,10);
 SELECT value INTO selected_template FROM jsonb_array_elements(plan->'templates')
 WHERE value->>'id'=selected_week->'questIds'->>NEW.slot;
 IF policy IS NULL OR selected_template IS NULL
 OR (selected_template->>'testXp')::integer<>NEW.test_xp THEN
  RAISE EXCEPTION 'Weekly test receipt differs from published quest';
 END IF;
 expected_instance=encode(sha256(convert_to(format('["weekly","%s","%s",%s]',NEW.campaign_id,start_iso,NEW.slot),'UTF8')),'hex');
 expected_completion=encode(sha256(convert_to(format('["weekly-completion","%s","%s","%s"]',NEW.campaign_id,expected_instance,NEW.passport_id),'UTF8')),'hex');
 IF NEW.instance_key<>expected_instance OR NEW.completion_key<>expected_completion THEN
  RAISE EXCEPTION 'Weekly completion identity differs';
 END IF;
 SELECT count(*),coalesce(sum(test_xp),0),
 coalesce(sum(test_xp) FILTER(WHERE starts_at=NEW.starts_at),0),
 coalesce(sum(test_xp) FILTER(WHERE starts_at=NEW.starts_at AND passport_id=NEW.passport_id),0)
 INTO history_count,year_used,epoch_used,person_used
 FROM quest.weekly_test_receipts WHERE campaign_id=NEW.campaign_id;
 IF history_count>=20000 OR year_used+NEW.test_xp>(policy->>'perCampaignYearXp')::numeric
 OR epoch_used+NEW.test_xp>(policy->>'perCampaignEpochXp')::numeric
 OR person_used+NEW.test_xp>(policy->>'perPassportEpochXp')::numeric THEN
  RAISE EXCEPTION 'Weekly test budget exhausted';
 END IF;
 NEW.recorded_at=selected_clock;
 RETURN NEW;
END;
$$;
CREATE TRIGGER weekly_test_policy_insert BEFORE INSERT ON quest.weekly_test_policies
 FOR EACH ROW EXECUTE FUNCTION quest.guard_weekly_test_policy();
CREATE TRIGGER weekly_test_receipt_insert BEFORE INSERT ON quest.weekly_test_receipts
 FOR EACH ROW EXECUTE FUNCTION quest.guard_weekly_test_receipt();
CREATE TRIGGER weekly_test_policies_immutable BEFORE UPDATE OR DELETE ON quest.weekly_test_policies
 FOR EACH ROW EXECUTE FUNCTION quest.reject_calendar_change();
CREATE TRIGGER weekly_test_receipts_immutable BEFORE UPDATE OR DELETE ON quest.weekly_test_receipts
 FOR EACH ROW EXECUTE FUNCTION quest.reject_calendar_change();
-- SELECT FOR SHARE requires UPDATE permission. Expose only this lock/read
-- operation instead of granting the reservation role cursor write authority.
CREATE FUNCTION quest.lock_weekly_test_source(selected_campaign text)
RETURNS TABLE(program_id text,decoder_version text,reconciliation_start_slot bigint,next_slot bigint,reconciled_through_slot bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest,genesis AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM quest.environment_identity WHERE singleton AND network='DEVNET' AND namespace='quest') THEN
  RAISE EXCEPTION 'Dedicated Devnet source required';
 END IF;
 RETURN QUERY SELECT c.program_id,c.decoder_version,c.reconciliation_start_slot,c.next_slot,c.reconciled_through_slot
 FROM genesis.indexer_cursors c WHERE c.campaign_id=selected_campaign FOR SHARE OF c;
END;
$$;
REVOKE ALL ON FUNCTION quest.lock_weekly_test_source(text) FROM PUBLIC;
REVOKE ALL ON quest.weekly_test_policies,quest.weekly_test_receipts FROM PUBLIC;
COMMIT;
