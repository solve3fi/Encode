-- Devnet TEST referrals. A Passport has one shareable code; another Passport redeems it once; the
-- referrer then earns a percentage of the XP the referred Passport earns AFTER redeeming. Test XP
-- only: no live rate, cap or eligibility rule is implied. Append-only upgrade of 001..018.
--
-- Evidence and trust: the browser never writes XP. The only writers are the SECURITY DEFINER
-- functions below. A bonus is itself an AWARD in the append-only xp_events ledger with a unique
-- source key per referred XP event, so a replay, retry or second trigger cannot pay it twice, and a
-- reversal of the referred Passport's XP reverses its bonus. Bonuses are never themselves referred.
BEGIN;

CREATE TABLE quest.referral_rules (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 rate_percent integer NOT NULL CHECK (rate_percent BETWEEN 1 AND 100),
 max_referrals_per_code integer NOT NULL CHECK (max_referrals_per_code > 0),
 rule_revision integer NOT NULL CHECK (rule_revision > 0)
);
REVOKE ALL ON quest.referral_rules FROM PUBLIC;
INSERT INTO quest.referral_rules (rate_percent, max_referrals_per_code, rule_revision) VALUES (10, 25, 1);

CREATE FUNCTION quest.guard_referral_rows() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'Referral rows are append-only; add a new rule revision through a reviewed migration';
END;
$$;
CREATE TRIGGER referral_rules_immutable BEFORE UPDATE OR DELETE ON quest.referral_rules
 FOR EACH ROW EXECUTE FUNCTION quest.guard_referral_rows();
CREATE TRIGGER referral_rules_no_truncate BEFORE TRUNCATE ON quest.referral_rules
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_referral_rows();

CREATE TABLE quest.referral_codes (
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 passport_id uuid PRIMARY KEY,
 code text NOT NULL UNIQUE CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (network, passport_id) REFERENCES quest.passports (network, passport_id)
);
REVOKE ALL ON quest.referral_codes FROM PUBLIC;
CREATE TRIGGER referral_codes_immutable BEFORE UPDATE OR DELETE ON quest.referral_codes
 FOR EACH ROW EXECUTE FUNCTION quest.guard_referral_rows();

CREATE TABLE quest.referrals (
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 referred_passport_id uuid PRIMARY KEY,
 referrer_passport_id uuid NOT NULL,
 code text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (referred_passport_id <> referrer_passport_id),
 FOREIGN KEY (network, referred_passport_id) REFERENCES quest.passports (network, passport_id),
 FOREIGN KEY (network, referrer_passport_id) REFERENCES quest.passports (network, passport_id)
);
CREATE INDEX referrals_by_referrer ON quest.referrals (referrer_passport_id);
REVOKE ALL ON quest.referrals FROM PUBLIC;
CREATE TRIGGER referrals_immutable BEFORE UPDATE OR DELETE ON quest.referrals
 FOR EACH ROW EXECUTE FUNCTION quest.guard_referral_rows();

-- Your shareable code (created on first use) and your referral totals. Returns no other Passport id.
CREATE FUNCTION quest.referral_overview(p_passport uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.referral_rules%ROWTYPE; c text; attempts integer := 0;
BEGIN
 SELECT * INTO r FROM quest.referral_rules;
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network='DEVNET' AND passport_id=p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 SELECT code INTO c FROM quest.referral_codes WHERE passport_id=p_passport;
 WHILE c IS NULL AND attempts < 20 LOOP
  attempts := attempts + 1;
  BEGIN
   INSERT INTO quest.referral_codes (passport_id, code)
   VALUES (p_passport, (SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random()*32)::int, 1), '')
                        FROM generate_series(1, 8)))
   ON CONFLICT (passport_id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT code INTO c FROM quest.referral_codes WHERE passport_id=p_passport;
 END LOOP;
 IF c IS NULL THEN RAISE EXCEPTION 'Referral code unavailable'; END IF;
 RETURN jsonb_build_object(
  'code', c,
  'ratePercent', r.rate_percent,
  'maxReferrals', r.max_referrals_per_code,
  'referredCount', (SELECT count(*) FROM quest.referrals WHERE referrer_passport_id=p_passport)::int,
  'bonusXp', COALESCE((SELECT sum(xp_delta) FROM quest.xp_events
                       WHERE network='DEVNET' AND passport_id=p_passport AND qualification_key='referral-bonus'), 0)::bigint,
  'referredBy', EXISTS (SELECT 1 FROM quest.referrals WHERE referred_passport_id=p_passport));
END;
$$;
REVOKE ALL ON FUNCTION quest.referral_overview(uuid) FROM PUBLIC;

-- Redeem someone's code once. Returns OK, INVALID, SELF, ALREADY, CYCLE or FULL.
CREATE FUNCTION quest.redeem_referral(p_passport uuid, p_code text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.referral_rules%ROWTYPE; n text := upper(btrim(p_code)); referrer uuid; n_inserted integer;
BEGIN
 SELECT * INTO r FROM quest.referral_rules;
 IF n IS NULL OR n !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN 'INVALID'; END IF;
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network='DEVNET' AND passport_id=p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 IF EXISTS (SELECT 1 FROM quest.referrals WHERE referred_passport_id=p_passport) THEN RETURN 'ALREADY'; END IF;
 -- Lock the code row so two redemptions cannot both take the last slot.
 SELECT passport_id INTO referrer FROM quest.referral_codes WHERE code=n FOR UPDATE;
 IF referrer IS NULL THEN RETURN 'INVALID'; END IF;
 IF referrer = p_passport THEN RETURN 'SELF'; END IF;
 -- Calendar operator identities are not players, on either side.
 IF EXISTS (SELECT 1 FROM quest.calendar_operator_grants g WHERE g.network='DEVNET' AND g.passport_id IN (referrer, p_passport)) THEN
  RETURN 'INVALID';
 END IF;
 IF EXISTS (SELECT 1 FROM quest.referrals WHERE referred_passport_id=referrer AND referrer_passport_id=p_passport) THEN
  RETURN 'CYCLE';
 END IF;
 IF (SELECT count(*) FROM quest.referrals WHERE referrer_passport_id=referrer) >= r.max_referrals_per_code THEN RETURN 'FULL'; END IF;
 INSERT INTO quest.referrals (referred_passport_id, referrer_passport_id, code)
 VALUES (p_passport, referrer, n) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n_inserted = ROW_COUNT;
 RETURN CASE WHEN n_inserted = 1 THEN 'OK' ELSE 'ALREADY' END;
END;
$$;
REVOKE ALL ON FUNCTION quest.redeem_referral(uuid, text) FROM PUBLIC;

-- The referrer earns rate_percent of each AWARD the referred Passport earns after redeeming (floor,
-- skipped when it rounds to zero). Bonuses are not referred again, so there is no recursion.
CREATE FUNCTION quest.award_referral_bonus() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.referral_rules%ROWTYPE; ref quest.referrals%ROWTYPE; bonus bigint; original quest.xp_events%ROWTYPE; paid quest.xp_events%ROWTYPE;
BEGIN
 SELECT * INTO r FROM quest.referral_rules;
 IF NEW.kind = 'AWARD' THEN
  IF NEW.qualification_key = 'referral-bonus' THEN RETURN NEW; END IF;
  SELECT * INTO ref FROM quest.referrals WHERE referred_passport_id = NEW.passport_id;
  IF NOT FOUND OR NEW.recorded_at < ref.created_at THEN RETURN NEW; END IF;
  bonus := (NEW.xp_delta * r.rate_percent) / 100;
  IF bonus < 1 THEN RETURN NEW; END IF;
  INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, source_event_key, qualification_key,
                               rule_revision, season_key, evidence_sha256, xp_delta)
  VALUES ('DEVNET', ref.referrer_passport_id, 'referral:' || NEW.event_id, 'AWARD', 'referral:' || NEW.event_id,
          'referral-bonus', r.rule_revision, NEW.season_key,
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
REVOKE ALL ON FUNCTION quest.award_referral_bonus() FROM PUBLIC;
CREATE TRIGGER xp_events_referral_bonus AFTER INSERT ON quest.xp_events
 FOR EACH ROW EXECUTE FUNCTION quest.award_referral_bonus();

COMMIT;
