-- Close graph-cycle, net-bonus and rolling-quota races without changing approved XP values.
BEGIN;
-- Mutating guard rows also make stale REPEATABLE READ transactions fail with
-- a serialization error, rather than counting an old graph/quota after waiting.
CREATE TABLE quest.referral_graph_guard (singleton boolean PRIMARY KEY CHECK(singleton),revision bigint NOT NULL);
INSERT INTO quest.referral_graph_guard VALUES(true,0);
CREATE TABLE quest.scout_submission_guards (
 network text NOT NULL DEFAULT 'DEVNET' CHECK(network='DEVNET'),passport_id uuid PRIMARY KEY,revision bigint NOT NULL,
 FOREIGN KEY(network,passport_id) REFERENCES quest.passports(network,passport_id)
);
REVOKE ALL ON quest.referral_graph_guard,quest.scout_submission_guards FROM PUBLIC;
CREATE OR REPLACE FUNCTION quest.referral_overview(p_passport uuid) RETURNS jsonb
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
                       WHERE network='DEVNET' AND passport_id=p_passport AND (qualification_key='referral-bonus' OR reverses_event_id IN (SELECT event_id FROM quest.xp_events WHERE qualification_key='referral-bonus'))), 0)::bigint,
  'referredBy', EXISTS (SELECT 1 FROM quest.referrals WHERE referred_passport_id=p_passport));
END;
$$;
CREATE OR REPLACE FUNCTION quest.redeem_referral(p_passport uuid, p_code text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.referral_rules%ROWTYPE; n text := upper(btrim(p_code)); referrer uuid; n_inserted integer;
BEGIN
 PERFORM pg_advisory_xact_lock(61749, 1);
 UPDATE quest.referral_graph_guard SET revision=revision+1 WHERE singleton;
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
 IF EXISTS (WITH RECURSIVE ancestors(id) AS (SELECT referrer UNION SELECT x.referrer_passport_id FROM quest.referrals x JOIN ancestors a ON x.referred_passport_id=a.id) SELECT 1 FROM ancestors WHERE id=p_passport) THEN
  RETURN 'CYCLE';
 END IF;
 IF (SELECT count(*) FROM quest.referrals WHERE referrer_passport_id=referrer) >= r.max_referrals_per_code THEN RETURN 'FULL'; END IF;
 INSERT INTO quest.referrals (referred_passport_id, referrer_passport_id, code)
 VALUES (p_passport, referrer, n) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n_inserted = ROW_COUNT;
 RETURN CASE WHEN n_inserted = 1 THEN 'OK' ELSE 'ALREADY' END;
END;
$$;
CREATE OR REPLACE FUNCTION quest.award_referral_bonus() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.referral_rules%ROWTYPE; ref quest.referrals%ROWTYPE; bonus bigint; original quest.xp_events%ROWTYPE; paid quest.xp_events%ROWTYPE;
BEGIN
 SELECT * INTO r FROM quest.referral_rules;
 IF NEW.kind = 'AWARD' THEN
  IF NEW.qualification_key = 'referral-bonus' THEN RETURN NEW; END IF;
  SELECT * INTO ref FROM quest.referrals WHERE referred_passport_id = NEW.passport_id;
  IF NOT FOUND OR NEW.recorded_at < ref.created_at THEN RETURN NEW; END IF;
  bonus := floor(NEW.xp_delta::numeric * r.rate_percent / 100)::bigint;
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
CREATE OR REPLACE FUNCTION quest.submit_partner_lead(p_passport uuid, p_name text, p_url text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE name_clean text := btrim(p_name); url_clean text := btrim(p_url); key text; recent integer; weekly integer; new_id bigint;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 IF name_clean IS NULL OR length(name_clean) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'The partner name needs 2 to 80 characters'; END IF;
 IF url_clean IS NULL OR length(url_clean) NOT BETWEEN 8 AND 200 OR url_clean !~ '^https?://[^[:space:]/?#]+' THEN
  RAISE EXCEPTION 'The partner link must be a web address';
 END IF;
 IF p_note IS NOT NULL AND length(p_note) > 300 THEN RAISE EXCEPTION 'The note is too long'; END IF;
 key := lower(regexp_replace(regexp_replace(substring(url_clean FROM '^https?://([^[:space:]/?#]+)'), '^www\.', ''), ':[0-9]+$', ''));
 -- Serialize the rolling quota for this Passport before counting.
 INSERT INTO quest.scout_submission_guards(passport_id,revision) VALUES(p_passport,1)
 ON CONFLICT(passport_id) DO UPDATE SET revision=quest.scout_submission_guards.revision+1;
 SELECT weekly_limit INTO weekly FROM quest.partner_scout_rules WHERE singleton;
 SELECT count(*) INTO recent FROM quest.partner_leads
  WHERE passport_id = p_passport AND submitted_at > clock_timestamp() - interval '7 days';
 IF recent >= weekly THEN RAISE EXCEPTION 'Too many leads this week'; END IF;
 IF EXISTS (SELECT 1 FROM quest.partner_leads WHERE partner_key = key AND status <> 'REJECTED') THEN
  RETURN jsonb_build_object('result', 'DUPLICATE');
 END IF;
 INSERT INTO quest.partner_leads (passport_id, partner_name, partner_url, note, partner_key)
 VALUES (p_passport, name_clean, url_clean, NULLIF(btrim(p_note), ''), key) RETURNING lead_id INTO new_id;
 RETURN jsonb_build_object('result', 'OK', 'leadId', new_id);
END;
$$;
CREATE TABLE quest.abuse_hardening_revision (singleton boolean PRIMARY KEY CHECK(singleton));
INSERT INTO quest.abuse_hardening_revision VALUES(true);
REVOKE ALL ON quest.abuse_hardening_revision FROM PUBLIC;
COMMIT;
