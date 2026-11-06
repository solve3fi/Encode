-- Devnet TEST XP for completed weekly quests. A weekly test receipt is only ever created by the
-- trusted settler through the receipt store, after the store has checked the calendar, the active
-- week, the source watermark and the XP ceilings (per Passport, per campaign epoch, per campaign
-- year) inside the receipt guard trigger. This migration adds the single missing step: each new
-- receipt becomes one AWARD in the append-only xp_events ledger.
--
-- Once per receipt: the receipt key is the unique source identity, so a replay, a retry or a second
-- settler cannot award twice. No browser, gateway or serving role can write XP; only this trigger.
-- Test XP only: there is no live rate, cap or eligibility rule here. Append-only upgrade of 001..017.
BEGIN;

CREATE FUNCTION quest.award_weekly_test_xp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE policy_revision integer;
BEGIN
 SELECT (document->>'revision')::integer INTO policy_revision
 FROM quest.weekly_test_policies WHERE campaign_id=NEW.campaign_id;
 INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,season_key,evidence_sha256,xp_delta)
 VALUES('DEVNET',NEW.passport_id,'weekly-test:'||NEW.completion_key,'AWARD','weekly-test:'||NEW.completion_key,'weekly-quest',
  COALESCE(policy_revision,1),'devnet-test-2026',NEW.facts_sha256,NEW.test_xp)
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.award_weekly_test_xp() FROM PUBLIC;
CREATE TRIGGER weekly_receipt_test_xp AFTER INSERT ON quest.weekly_test_receipts
 FOR EACH ROW EXECUTE FUNCTION quest.award_weekly_test_xp();

-- Receipts that already exist are credited once (none in production today).
INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,season_key,evidence_sha256,xp_delta)
SELECT 'DEVNET',r.passport_id,'weekly-test:'||r.completion_key,'AWARD','weekly-test:'||r.completion_key,'weekly-quest',
 COALESCE((p.document->>'revision')::integer,1),'devnet-test-2026',r.facts_sha256,r.test_xp
FROM quest.weekly_test_receipts r LEFT JOIN quest.weekly_test_policies p ON p.campaign_id=r.campaign_id
ON CONFLICT DO NOTHING;

COMMIT;
