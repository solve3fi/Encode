-- Devnet TEST "Partner Scout": a Passport holder submits a lead for a partner they think Solve3 should onboard. An admin
-- reviews it. When the admin marks the partner onboarded, the scout is paid a one-time bounty (the first valid lead for a
-- partner wins). XP is never paid on submission, so spam earns nothing. Submissions are limited per week. Every admin
-- action is an append-only audit row naming the admin wallet. The bounty goes through the same xp_events ledger as every
-- other award, and the community-xp pause switch (migration 024) stops it. Append-only upgrade of 001..024.
BEGIN;

CREATE TABLE quest.partner_scout_rules (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 bounty_xp integer NOT NULL CHECK (bounty_xp BETWEEN 1 AND 100000),
 weekly_limit integer NOT NULL CHECK (weekly_limit BETWEEN 1 AND 50),
 revision integer NOT NULL DEFAULT 1
);
INSERT INTO quest.partner_scout_rules (bounty_xp, weekly_limit) VALUES (5000, 3);
REVOKE ALL ON quest.partner_scout_rules FROM PUBLIC;

CREATE FUNCTION quest.guard_partner_scout_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'Partner scout history is append-only';
END;
$$;

CREATE TABLE quest.partner_leads (
 lead_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 passport_id uuid NOT NULL,
 partner_name text NOT NULL CHECK (length(partner_name) BETWEEN 2 AND 80),
 partner_url text NOT NULL CHECK (length(partner_url) BETWEEN 8 AND 200 AND partner_url ~ '^https?://[^[:space:]/?#]+'),
 note text CHECK (note IS NULL OR length(note) <= 300),
 partner_key text NOT NULL CHECK (length(partner_key) BETWEEN 3 AND 120),
 status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'REJECTED', 'ONBOARDED')),
 admin_note text CHECK (admin_note IS NULL OR length(admin_note) <= 200),
 decided_by text CHECK (decided_by IS NULL OR (length(decided_by) BETWEEN 32 AND 44 AND decided_by ~ '^[1-9A-HJ-NP-Za-km-z]+$')),
 decided_at timestamptz,
 submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (network, passport_id) REFERENCES quest.passports (network, passport_id),
 CHECK ((status = 'SUBMITTED') = (decided_at IS NULL))
);
-- The first valid lead for a partner wins; a rejected lead frees the partner for someone else.
CREATE UNIQUE INDEX partner_leads_one_active_per_partner ON quest.partner_leads (partner_key) WHERE status <> 'REJECTED';
CREATE INDEX partner_leads_by_passport ON quest.partner_leads (passport_id, submitted_at);
REVOKE ALL ON quest.partner_leads FROM PUBLIC;
CREATE FUNCTION quest.guard_partner_lead_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Partner leads cannot be deleted'; END IF;
 IF OLD.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'A decided lead cannot change'; END IF;
 IF ROW(NEW.lead_id, NEW.passport_id, NEW.partner_name, NEW.partner_url, NEW.note, NEW.partner_key, NEW.submitted_at)
    IS DISTINCT FROM ROW(OLD.lead_id, OLD.passport_id, OLD.partner_name, OLD.partner_url, OLD.note, OLD.partner_key, OLD.submitted_at) THEN
  RAISE EXCEPTION 'Only the decision can change';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER partner_leads_guard BEFORE UPDATE OR DELETE ON quest.partner_leads
 FOR EACH ROW EXECUTE FUNCTION quest.guard_partner_lead_update();
CREATE TRIGGER partner_leads_no_truncate BEFORE TRUNCATE ON quest.partner_leads
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_partner_scout_history();

CREATE TABLE quest.partner_lead_audit (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 lead_id bigint NOT NULL REFERENCES quest.partner_leads (lead_id),
 action text NOT NULL CHECK (action IN ('REJECT', 'ONBOARD')),
 actor_wallet text NOT NULL CHECK (length(actor_wallet) BETWEEN 32 AND 44 AND actor_wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 detail jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON quest.partner_lead_audit FROM PUBLIC;
CREATE TRIGGER partner_lead_audit_immutable BEFORE UPDATE OR DELETE ON quest.partner_lead_audit
 FOR EACH ROW EXECUTE FUNCTION quest.guard_partner_scout_history();
CREATE TRIGGER partner_lead_audit_no_truncate BEFORE TRUNCATE ON quest.partner_lead_audit
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_partner_scout_history();

-- ---- player functions -------------------------------------------------------------------------------------
-- Submit a lead. The partner is identified by its web address (host without "www." and port), so two people naming the
-- same site collide. Over the weekly limit is an error; a partner that already has a live lead is reported, not raised.
CREATE FUNCTION quest.submit_partner_lead(p_passport uuid, p_name text, p_url text, p_note text) RETURNS jsonb
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
REVOKE ALL ON FUNCTION quest.submit_partner_lead(uuid, text, text, text) FROM PUBLIC;

-- A Passport's own view: the bounty, how many leads it may still send this week, and its leads.
CREATE FUNCTION quest.partner_scout_overview(p_passport uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
 SELECT jsonb_build_object(
  'bountyXp', r.bounty_xp,
  'weeklyLimit', r.weekly_limit,
  'remainingThisWeek', GREATEST(0, r.weekly_limit - (SELECT count(*) FROM quest.partner_leads x
      WHERE x.passport_id = p_passport AND x.submitted_at > clock_timestamp() - interval '7 days')::integer),
  'leads', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', l.partner_name, 'url', l.partner_url, 'status', l.status,
      'submittedAt', l.submitted_at, 'note', CASE WHEN l.status = 'REJECTED' THEN l.admin_note ELSE NULL END
    ) ORDER BY l.submitted_at DESC) FROM (SELECT * FROM quest.partner_leads WHERE passport_id = p_passport
      ORDER BY submitted_at DESC LIMIT 20) l), '[]'::jsonb))
 FROM quest.partner_scout_rules r WHERE r.singleton;
$$;
REVOKE ALL ON FUNCTION quest.partner_scout_overview(uuid) FROM PUBLIC;

-- ---- admin functions --------------------------------------------------------------------------------------
-- The bounty and every lead with its scout (Passport id and the wallet it is linked to): undecided first, then newest,
-- capped at 200.
CREATE FUNCTION quest.partner_leads_admin() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
 SELECT jsonb_build_object('bountyXp', (SELECT bounty_xp FROM quest.partner_scout_rules WHERE singleton), 'leads', COALESCE(jsonb_agg(jsonb_build_object(
  'leadId', l.lead_id, 'partnerName', l.partner_name, 'partnerUrl', l.partner_url, 'note', l.note,
  'partnerKey', l.partner_key, 'status', l.status, 'adminNote', l.admin_note, 'decidedAt', l.decided_at,
  'submittedAt', l.submitted_at, 'passportId', l.passport_id,
  'scoutWallet', (SELECT w.wallet FROM quest.wallet_links w WHERE w.network = 'DEVNET' AND w.passport_id = l.passport_id
                  AND w.unlinked_at IS NULL ORDER BY w.linked_at LIMIT 1)
 ) ORDER BY (l.status = 'SUBMITTED') DESC, l.submitted_at DESC), '[]'::jsonb))
 FROM (SELECT * FROM quest.partner_leads ORDER BY submitted_at DESC LIMIT 200) l;
$$;
REVOKE ALL ON FUNCTION quest.partner_leads_admin() FROM PUBLIC;

CREATE FUNCTION quest.reject_partner_lead(p_lead bigint, p_actor text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE lead quest.partner_leads;
BEGIN
 IF p_note IS NOT NULL AND length(p_note) > 200 THEN RAISE EXCEPTION 'The note is too long'; END IF;
 SELECT * INTO lead FROM quest.partner_leads WHERE lead_id = p_lead FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown lead'; END IF;
 IF lead.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'This lead is already decided'; END IF;
 UPDATE quest.partner_leads SET status = 'REJECTED', admin_note = NULLIF(btrim(p_note), ''), decided_by = p_actor, decided_at = clock_timestamp()
 WHERE lead_id = p_lead;
 INSERT INTO quest.partner_lead_audit (lead_id, action, actor_wallet, detail)
 VALUES (p_lead, 'REJECT', p_actor, jsonb_build_object('note', NULLIF(btrim(p_note), '')));
 RETURN jsonb_build_object('leadId', p_lead, 'status', 'REJECTED');
END;
$$;
REVOKE ALL ON FUNCTION quest.reject_partner_lead(bigint, text, text) FROM PUBLIC;

-- Mark the partner onboarded and pay the scout the bounty, once. Refused while community-xp is paused.
CREATE FUNCTION quest.onboard_partner_lead(p_lead bigint, p_actor text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE lead quest.partner_leads; rules quest.partner_scout_rules; paid integer;
BEGIN
 IF quest.pause_enabled('community-xp') THEN RAISE EXCEPTION 'Community XP is paused'; END IF;
 IF p_note IS NOT NULL AND length(p_note) > 200 THEN RAISE EXCEPTION 'The note is too long'; END IF;
 SELECT * INTO lead FROM quest.partner_leads WHERE lead_id = p_lead FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown lead'; END IF;
 IF lead.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'This lead is already decided'; END IF;
 SELECT * INTO rules FROM quest.partner_scout_rules WHERE singleton;
 INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, source_event_key, qualification_key,
  rule_revision, season_key, evidence_sha256, xp_delta)
 VALUES ('DEVNET', lead.passport_id, 'partner-scout:' || lead.partner_key, 'AWARD', 'partner-scout:' || lead.partner_key,
  'partner-scout', rules.revision, 'devnet-test-2026',
  encode(sha256(convert_to('partner-scout|' || lead.partner_key || '|' || lead.lead_id, 'UTF8')), 'hex'), rules.bounty_xp)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS paid = ROW_COUNT;
 IF paid <> 1 THEN RAISE EXCEPTION 'This partner has already paid a bounty'; END IF;
 UPDATE quest.partner_leads SET status = 'ONBOARDED', admin_note = NULLIF(btrim(p_note), ''), decided_by = p_actor, decided_at = clock_timestamp()
 WHERE lead_id = p_lead;
 INSERT INTO quest.partner_lead_audit (lead_id, action, actor_wallet, detail)
 VALUES (p_lead, 'ONBOARD', p_actor, jsonb_build_object('bountyXp', rules.bounty_xp, 'note', NULLIF(btrim(p_note), '')));
 RETURN jsonb_build_object('leadId', p_lead, 'status', 'ONBOARDED', 'bountyXp', rules.bounty_xp);
END;
$$;
REVOKE ALL ON FUNCTION quest.onboard_partner_lead(bigint, text, text) FROM PUBLIC;

COMMIT;
