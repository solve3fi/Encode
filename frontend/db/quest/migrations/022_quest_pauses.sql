-- Devnet Quest pause switches: five independent emergency stops, each enforced INSIDE the database so
-- every writer honours them (the XP settler, the Pass and referral functions, the sign-in trigger). A
-- switch changes only through quest.set_pause, which writes an append-only audit row, and only a
-- dedicated login role may execute it. Pausing never destroys evidence: votes, swaps, liquidity and
-- Pass mints keep being recorded, and awards that were held back are made once the switch is released.
-- Append-only upgrade of 001..021.
--
--   weekly-xp      weekly quest XP: a new weekly receipt is refused, so the settler keeps retrying and
--                  awards the quests once released (receipts are recomputed from the ledger each round)
--   voting-xp      governance XP and Levels: settlement returns early; observations continue
--   onboarding-xp  connect-wallet and mint-pass XP: the award is skipped, then re-awarded on release
--   referrals      redeeming a referral code is refused
--   pass-mint      a NEW Pass reservation is refused; mints already reserved can still be verified
BEGIN;

CREATE FUNCTION quest.guard_pause_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'The pause audit is append-only';
END;
$$;

CREATE TABLE quest.pause_switches (
 switch_key text PRIMARY KEY CHECK (switch_key IN ('weekly-xp', 'voting-xp', 'onboarding-xp', 'referrals', 'pass-mint')),
 paused boolean NOT NULL DEFAULT false,
 reason text CHECK (reason IS NULL OR length(reason) <= 200),
 changed_by text,
 changed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO quest.pause_switches (switch_key) VALUES
 ('weekly-xp'), ('voting-xp'), ('onboarding-xp'), ('referrals'), ('pass-mint');
REVOKE ALL ON quest.pause_switches FROM PUBLIC;
CREATE TRIGGER pause_switches_no_delete BEFORE DELETE OR TRUNCATE ON quest.pause_switches
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_pause_audit();

CREATE TABLE quest.pause_audit (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 switch_key text NOT NULL,
 paused boolean NOT NULL,
 reason text,
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON quest.pause_audit FROM PUBLIC;
CREATE TRIGGER pause_audit_immutable BEFORE UPDATE OR DELETE ON quest.pause_audit
 FOR EACH ROW EXECUTE FUNCTION quest.guard_pause_audit();
CREATE TRIGGER pause_audit_no_truncate BEFORE TRUNCATE ON quest.pause_audit
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_pause_audit();

-- An unknown switch is an error, never "not paused", so a typo cannot silently disable a stop.
CREATE FUNCTION quest.pause_enabled(p_key text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE is_paused boolean;
BEGIN
 SELECT paused INTO is_paused FROM quest.pause_switches WHERE switch_key = p_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pause switch'; END IF;
 RETURN is_paused;
END;
$$;
REVOKE ALL ON FUNCTION quest.pause_enabled(text) FROM PUBLIC;

CREATE FUNCTION quest.pause_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
 SELECT COALESCE(jsonb_object_agg(switch_key, jsonb_build_object(
  'paused', paused,
  'reason', reason,
  'changedBy', changed_by,
  'changedAt', to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
 ) ORDER BY switch_key), '{}'::jsonb)
 FROM quest.pause_switches;
$$;
REVOKE ALL ON FUNCTION quest.pause_status() FROM PUBLIC;

-- Awards that were skipped while onboarding XP was paused. Idempotent: the ledger's unique keys make a
-- Passport that was already credited a no-op. Mirrors the one-time backfill of migration 017.
CREATE FUNCTION quest.catch_up_onboarding_xp() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE awarded integer := 0; granted boolean; rec record;
BEGIN
 FOR rec IN
  SELECT c.passport_id, c.wallet, c.nonce_hash
  FROM (SELECT DISTINCT ON (passport_id) * FROM quest.wallet_challenges
        WHERE consumed_at IS NOT NULL AND action = 'passport.authenticate' ORDER BY passport_id, consumed_at) c
 LOOP
  SELECT quest.award_devnet_onboarding_xp(rec.passport_id, 'connect-wallet', 'wallet:' || rec.wallet,
   encode(sha256(convert_to('connect-wallet|' || rec.wallet || '|' || rec.nonce_hash, 'UTF8')), 'hex')) INTO granted;
  IF granted THEN awarded := awarded + 1; END IF;
 END LOOP;
 FOR rec IN
  SELECT m.passport_id, m.wallet, m.mint FROM quest.pass_mint_reservations m WHERE m.verified_at IS NOT NULL
 LOOP
  SELECT quest.award_devnet_onboarding_xp(rec.passport_id, 'mint-pass', 'pass-mint:' || rec.mint,
   encode(sha256(convert_to('mint-pass|' || rec.wallet || '|' || rec.mint, 'UTF8')), 'hex')) INTO granted;
  IF granted THEN awarded := awarded + 1; END IF;
 END LOOP;
 RETURN awarded;
END;
$$;
REVOKE ALL ON FUNCTION quest.catch_up_onboarding_xp() FROM PUBLIC;

-- The one way to move a switch. The actor is the admin wallet the request was signed by; a reason is
-- required when pausing so the audit says why.
CREATE FUNCTION quest.set_pause(p_key text, p_paused boolean, p_reason text, p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE caught_up integer := 0;
BEGIN
 IF p_actor IS NULL OR length(p_actor) NOT BETWEEN 32 AND 44 OR p_actor !~ '^[1-9A-HJ-NP-Za-km-z]+$' THEN
  RAISE EXCEPTION 'A pause change needs the admin wallet that made it';
 END IF;
 IF p_paused AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
  RAISE EXCEPTION 'Pausing needs a reason';
 END IF;
 IF p_reason IS NOT NULL AND length(p_reason) > 200 THEN RAISE EXCEPTION 'The reason is too long'; END IF;
 UPDATE quest.pause_switches
 SET paused = p_paused, reason = CASE WHEN p_paused THEN btrim(p_reason) ELSE NULL END,
     changed_by = p_actor, changed_at = now()
 WHERE switch_key = p_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown pause switch'; END IF;
 INSERT INTO quest.pause_audit (switch_key, paused, reason, actor) VALUES (p_key, p_paused, NULLIF(btrim(p_reason), ''), p_actor);
 IF p_key = 'onboarding-xp' AND NOT p_paused THEN caught_up := quest.catch_up_onboarding_xp(); END IF;
 RETURN jsonb_build_object('switch', p_key, 'paused', p_paused, 'caughtUp', caught_up);
END;
$$;
REVOKE ALL ON FUNCTION quest.set_pause(text, boolean, text, text) FROM PUBLIC;

-- ---- Enforcement. Each guard is a trigger on the table the award path already writes.
CREATE FUNCTION quest.guard_paused_weekly_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 IF quest.pause_enabled('weekly-xp') THEN RAISE EXCEPTION 'Weekly quest XP is paused'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.guard_paused_weekly_receipt() FROM PUBLIC;
CREATE TRIGGER aaa_weekly_receipt_pause_guard BEFORE INSERT ON quest.weekly_test_receipts
 FOR EACH ROW EXECUTE FUNCTION quest.guard_paused_weekly_receipt();

-- Returning NULL skips the row without failing the sign-in or the Pass verification that triggered it.
CREATE FUNCTION quest.guard_paused_onboarding_xp() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 IF NEW.kind = 'AWARD' AND NEW.qualification_key IN ('connect-wallet', 'mint-pass')
    AND quest.pause_enabled('onboarding-xp') THEN
  RETURN NULL;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.guard_paused_onboarding_xp() FROM PUBLIC;
CREATE TRIGGER aaa_xp_events_onboarding_pause_guard BEFORE INSERT ON quest.xp_events
 FOR EACH ROW EXECUTE FUNCTION quest.guard_paused_onboarding_xp();

CREATE FUNCTION quest.guard_paused_referral() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 IF quest.pause_enabled('referrals') THEN RAISE EXCEPTION 'Referrals are paused'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.guard_paused_referral() FROM PUBLIC;
CREATE TRIGGER aaa_referral_pause_guard BEFORE INSERT ON quest.referrals
 FOR EACH ROW EXECUTE FUNCTION quest.guard_paused_referral();

-- A wallet that already has a reservation can still finish its mint; only a new reservation is refused.
CREATE FUNCTION quest.guard_paused_pass_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM quest.pass_mint_reservations WHERE network = NEW.network AND wallet = NEW.wallet) THEN
  RETURN NEW;
 END IF;
 IF quest.pause_enabled('pass-mint') THEN RAISE EXCEPTION 'New Pass mints are paused'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.guard_paused_pass_reservation() FROM PUBLIC;
CREATE TRIGGER aaa_pass_reservation_pause_guard BEFORE INSERT ON quest.pass_mint_reservations
 FOR EACH ROW EXECUTE FUNCTION quest.guard_paused_pass_reservation();

-- Governance settlement: replaces the migration 020 function with the same body plus the pause check.
-- Observations keep being recorded while paused; the epochs are awarded once the switch is released.
CREATE OR REPLACE FUNCTION quest.settle_voting_epochs() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE head bigint; rule quest.governance_test_rules%ROWTYPE; added integer;
BEGIN
 SELECT max(epoch_id) INTO head FROM quest.vote_epoch_heads WHERE network = 'DEVNET';
 IF head IS NULL THEN
  RETURN jsonb_build_object('settled', 0, 'currentEpoch', NULL);
 END IF;
 IF quest.pause_enabled('voting-xp') THEN
  RETURN jsonb_build_object('settled', 0, 'currentEpoch', head, 'paused', true);
 END IF;
 SELECT * INTO rule FROM quest.governance_test_rules WHERE singleton;
 WITH qualifying AS (
  SELECT o.epoch_id, l.passport_id,
   encode(sha256(convert_to(
    'governance-v' || rule.rule_revision || '|' || o.epoch_id || '|' || l.passport_id || '|' ||
    string_agg(o.vote_account || ':' || o.owner_wallet || ':' || o.voting_power || ':' ||
     extract(epoch FROM o.vote_time)::bigint, ',' ORDER BY o.vote_account), 'UTF8')), 'hex') AS evidence
  FROM quest.vote_observations o
  JOIN quest.wallet_links l
   ON l.network = o.network AND l.wallet = o.owner_wallet
   AND l.linked_at <= o.vote_time AND (l.unlinked_at IS NULL OR l.unlinked_at > o.vote_time)
  WHERE o.network = 'DEVNET' AND o.epoch_id < head AND o.voting_power >= rule.minimum_voting_power
  GROUP BY o.epoch_id, l.passport_id
 ), levels AS (
  INSERT INTO quest.level_events (network, passport_id, idempotency_key, kind, epoch_id, rule_revision, evidence_sha256, level_delta)
  SELECT 'DEVNET', q.passport_id, 'governance:' || q.epoch_id || ':' || q.passport_id, 'GOVERNANCE_EPOCH',
   q.epoch_id, rule.rule_revision, q.evidence, 1
  FROM qualifying q
  ON CONFLICT DO NOTHING
  RETURNING 1
 ), xp AS (
  INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, source_event_key, qualification_key,
   rule_revision, season_key, evidence_sha256, xp_delta)
  SELECT 'DEVNET', q.passport_id, 'governance:' || q.epoch_id || ':' || q.passport_id, 'AWARD',
   'governance:' || q.epoch_id || ':' || q.passport_id, 'governance-epoch', rule.rule_revision,
   'devnet-test-2026', q.evidence, rule.xp_per_epoch
  FROM qualifying q
  ON CONFLICT DO NOTHING
  RETURNING 1
 )
 SELECT (SELECT count(*) FROM xp) INTO added;
 RETURN jsonb_build_object('settled', added, 'currentEpoch', head);
END;
$$;

COMMIT;
