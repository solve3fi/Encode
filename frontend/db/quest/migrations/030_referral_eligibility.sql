-- Approved 2026-10-07: direct weekly activity and voting only. Prospective change;
-- previously paid bonuses remain auditable and still reverse with their original.
BEGIN;
CREATE TABLE quest.referral_eligible_sources (
 qualification_key text PRIMARY KEY CHECK(qualification_key IN ('weekly-quest','governance-epoch')),
 rule_revision integer NOT NULL CHECK(rule_revision=2)
);
INSERT INTO quest.referral_eligible_sources VALUES ('weekly-quest',2),('governance-epoch',2);
REVOKE ALL ON quest.referral_eligible_sources FROM PUBLIC;
CREATE TRIGGER referral_eligible_sources_immutable BEFORE UPDATE OR DELETE ON quest.referral_eligible_sources
 FOR EACH ROW EXECUTE FUNCTION quest.guard_referral_rows();
CREATE TRIGGER referral_eligible_sources_no_truncate BEFORE TRUNCATE ON quest.referral_eligible_sources
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_referral_rows();
CREATE OR REPLACE FUNCTION quest.award_referral_bonus() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.referral_rules%ROWTYPE; ref quest.referrals%ROWTYPE; bonus bigint; original quest.xp_events%ROWTYPE; paid quest.xp_events%ROWTYPE;
BEGIN
 SELECT * INTO r FROM quest.referral_rules;
 IF NEW.kind = 'AWARD' THEN
  IF NOT EXISTS (SELECT 1 FROM quest.referral_eligible_sources WHERE qualification_key=NEW.qualification_key) THEN RETURN NEW; END IF;
  SELECT * INTO ref FROM quest.referrals WHERE referred_passport_id = NEW.passport_id;
  IF NOT FOUND OR NEW.recorded_at < ref.created_at THEN RETURN NEW; END IF;
  bonus := floor(NEW.xp_delta::numeric * r.rate_percent / 100)::bigint;
  IF bonus < 1 THEN RETURN NEW; END IF;
  INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, source_event_key, qualification_key,
                               rule_revision, season_key, evidence_sha256, xp_delta)
  VALUES ('DEVNET', ref.referrer_passport_id, 'referral:' || NEW.event_id, 'AWARD', 'referral:' || NEW.event_id,
          'referral-bonus', 2, NEW.season_key,
          encode(sha256(convert_to('referral|' || NEW.event_id || '|' || ref.referrer_passport_id || '|' || NEW.passport_id, 'UTF8')), 'hex'),
          bonus)
  ON CONFLICT DO NOTHING;
 ELSIF NEW.kind = 'REVERSAL' THEN
  SELECT * INTO original FROM quest.xp_events WHERE event_id = NEW.reverses_event_id;
  IF NOT FOUND OR original.qualification_key = 'referral-bonus' THEN RETURN NEW; END IF;
  SELECT * INTO paid FROM quest.xp_events WHERE idempotency_key = 'referral:' || original.event_id AND kind = 'AWARD';
  IF FOUND AND NOT EXISTS (SELECT 1 FROM quest.xp_events WHERE reverses_event_id = paid.event_id) THEN
   INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, reverses_event_id, review_ref, season_key, xp_delta)
   VALUES ('DEVNET', paid.passport_id, 'referral-reversal:' || paid.event_id, 'REVERSAL', paid.event_id,
           'referral-reversal:' || NEW.event_id, paid.season_key, -paid.xp_delta)
   ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
COMMIT;
