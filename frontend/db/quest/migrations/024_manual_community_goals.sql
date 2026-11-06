-- Devnet TEST manual community goals. A monthly goal such as "Get a partner onboarded" is completed by a human
-- operator, not measured: completing it gives EVERY Passport that exists at that moment the goal's XP once.
-- Goals live in their own tables (the calendar's community goals are TVL measurements with proofs and only reserve
-- budget; they write no XP). Everything an operator does here is an append-only audit row naming the admin
-- wallet that signed it. The award goes through the same xp_events ledger as every other award, so the referral
-- rule, the XP totals and the Levels read it like any Quest XP. A sixth pause switch, community-xp, stops
-- completions. Append-only upgrade of 001..023.
BEGIN;

-- ---- the sixth pause switch -------------------------------------------------------------------------------
ALTER TABLE quest.pause_switches DROP CONSTRAINT pause_switches_switch_key_check;
ALTER TABLE quest.pause_switches ADD CONSTRAINT pause_switches_switch_key_check
 CHECK (switch_key IN ('weekly-xp', 'voting-xp', 'onboarding-xp', 'referrals', 'pass-mint', 'community-xp'));
INSERT INTO quest.pause_switches (switch_key) VALUES ('community-xp');

-- ---- goals, audit, completions ----------------------------------------------------------------------------
CREATE FUNCTION quest.guard_manual_goal_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'Manual goal history is append-only';
END;
$$;

CREATE TABLE quest.manual_goals (
 campaign_id text NOT NULL CHECK (campaign_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
 goal_id text NOT NULL CHECK (goal_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
 flavor_text text NOT NULL CHECK (length(flavor_text) BETWEEN 1 AND 300),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 xp_each integer NOT NULL CHECK (xp_each BETWEEN 1 AND 100000),
 revision integer NOT NULL DEFAULT 1,
 saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (campaign_id, goal_id),
 CHECK (starts_at < ends_at AND ends_at - starts_at <= interval '366 days')
);
REVOKE ALL ON quest.manual_goals FROM PUBLIC;
CREATE TRIGGER manual_goals_no_truncate BEFORE TRUNCATE ON quest.manual_goals
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_manual_goal_history();

CREATE TABLE quest.manual_goal_audit (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 campaign_id text NOT NULL,
 goal_id text NOT NULL,
 action text NOT NULL CHECK (action IN ('SAVE', 'REMOVE', 'COMPLETE')),
 actor_wallet text NOT NULL CHECK (length(actor_wallet) BETWEEN 32 AND 44 AND actor_wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 detail jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON quest.manual_goal_audit FROM PUBLIC;
CREATE TRIGGER manual_goal_audit_immutable BEFORE UPDATE OR DELETE ON quest.manual_goal_audit
 FOR EACH ROW EXECUTE FUNCTION quest.guard_manual_goal_history();
CREATE TRIGGER manual_goal_audit_no_truncate BEFORE TRUNCATE ON quest.manual_goal_audit
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_manual_goal_history();

CREATE TABLE quest.manual_goal_completions (
 campaign_id text NOT NULL,
 goal_id text NOT NULL,
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_wallet text NOT NULL CHECK (length(actor_wallet) BETWEEN 32 AND 44 AND actor_wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 note text CHECK (note IS NULL OR length(note) <= 200),
 xp_each integer NOT NULL,
 recipients integer NOT NULL CHECK (recipients >= 0),
 PRIMARY KEY (campaign_id, goal_id),
 FOREIGN KEY (campaign_id, goal_id) REFERENCES quest.manual_goals (campaign_id, goal_id)
);
REVOKE ALL ON quest.manual_goal_completions FROM PUBLIC;
CREATE TRIGGER manual_goal_completions_immutable BEFORE UPDATE OR DELETE ON quest.manual_goal_completions
 FOR EACH ROW EXECUTE FUNCTION quest.guard_manual_goal_history();
CREATE TRIGGER manual_goal_completions_no_truncate BEFORE TRUNCATE ON quest.manual_goal_completions
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_manual_goal_history();

-- ---- operator functions ----------------------------------------------------------------------------------
-- Create or change a goal. A goal that has started or been completed is fixed (players already saw it), so only
-- a goal that has not started can change; a brand-new goal may be created for a window that is already open.
CREATE FUNCTION quest.save_manual_goal(p_campaign text, p_goal text, p_title text, p_flavor text,
 p_starts timestamptz, p_ends timestamptz, p_xp integer, p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE existing quest.manual_goals; rev integer := 1;
BEGIN
 IF p_campaign IS NULL OR p_goal IS NULL OR p_title IS NULL OR p_flavor IS NULL OR p_starts IS NULL
    OR p_ends IS NULL OR p_xp IS NULL OR p_actor IS NULL THEN
  RAISE EXCEPTION 'Every goal field is required';
 END IF;
 IF p_ends <= clock_timestamp() THEN RAISE EXCEPTION 'A goal cannot end in the past'; END IF;
 SELECT * INTO existing FROM quest.manual_goals WHERE campaign_id = p_campaign AND goal_id = p_goal FOR UPDATE;
 IF FOUND THEN
  IF EXISTS (SELECT 1 FROM quest.manual_goal_completions c WHERE c.campaign_id = p_campaign AND c.goal_id = p_goal) THEN
   RAISE EXCEPTION 'A completed goal cannot change';
  END IF;
  IF existing.starts_at <= clock_timestamp() THEN RAISE EXCEPTION 'A goal that has started cannot change'; END IF;
  rev := existing.revision + 1;
  UPDATE quest.manual_goals SET title = p_title, flavor_text = p_flavor, starts_at = p_starts, ends_at = p_ends,
   xp_each = p_xp, revision = rev, saved_at = clock_timestamp()
  WHERE campaign_id = p_campaign AND goal_id = p_goal;
 ELSE
  INSERT INTO quest.manual_goals (campaign_id, goal_id, title, flavor_text, starts_at, ends_at, xp_each)
  VALUES (p_campaign, p_goal, p_title, p_flavor, p_starts, p_ends, p_xp);
 END IF;
 INSERT INTO quest.manual_goal_audit (campaign_id, goal_id, action, actor_wallet, detail)
 VALUES (p_campaign, p_goal, 'SAVE', p_actor, jsonb_build_object('title', p_title, 'xpEach', p_xp,
  'startsAt', p_starts, 'endsAt', p_ends, 'revision', rev));
 RETURN jsonb_build_object('campaignId', p_campaign, 'goalId', p_goal, 'revision', rev);
END;
$$;
REVOKE ALL ON FUNCTION quest.save_manual_goal(text, text, text, text, timestamptz, timestamptz, integer, text) FROM PUBLIC;

CREATE FUNCTION quest.remove_manual_goal(p_campaign text, p_goal text, p_actor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE existing quest.manual_goals;
BEGIN
 SELECT * INTO existing FROM quest.manual_goals WHERE campaign_id = p_campaign AND goal_id = p_goal FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown goal'; END IF;
 IF EXISTS (SELECT 1 FROM quest.manual_goal_completions c WHERE c.campaign_id = p_campaign AND c.goal_id = p_goal) THEN
  RAISE EXCEPTION 'A completed goal cannot be removed';
 END IF;
 IF existing.starts_at <= clock_timestamp() THEN RAISE EXCEPTION 'A goal that has started cannot be removed'; END IF;
 DELETE FROM quest.manual_goals WHERE campaign_id = p_campaign AND goal_id = p_goal;
 INSERT INTO quest.manual_goal_audit (campaign_id, goal_id, action, actor_wallet, detail)
 VALUES (p_campaign, p_goal, 'REMOVE', p_actor, jsonb_build_object('title', existing.title));
 RETURN jsonb_build_object('campaignId', p_campaign, 'goalId', p_goal, 'removed', true);
END;
$$;
REVOKE ALL ON FUNCTION quest.remove_manual_goal(text, text, text) FROM PUBLIC;

-- Complete a goal: every Passport that exists now receives the goal's XP once. Refused while the community-xp
-- switch is paused, outside the goal's window, or a second time. The whole thing is one transaction.
CREATE FUNCTION quest.complete_manual_goal(p_campaign text, p_goal text, p_actor text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE goal quest.manual_goals; audience integer; added integer; stamp timestamptz := clock_timestamp();
BEGIN
 IF quest.pause_enabled('community-xp') THEN RAISE EXCEPTION 'Community XP is paused'; END IF;
 IF p_note IS NOT NULL AND length(p_note) > 200 THEN RAISE EXCEPTION 'The note is too long'; END IF;
 SELECT * INTO goal FROM quest.manual_goals WHERE campaign_id = p_campaign AND goal_id = p_goal FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown goal'; END IF;
 IF EXISTS (SELECT 1 FROM quest.manual_goal_completions c WHERE c.campaign_id = p_campaign AND c.goal_id = p_goal) THEN
  RAISE EXCEPTION 'This goal is already completed';
 END IF;
 IF stamp < goal.starts_at OR stamp >= goal.ends_at THEN RAISE EXCEPTION 'The goal is outside its window'; END IF;
 SELECT count(*) INTO audience FROM quest.passports WHERE network = 'DEVNET';
 IF audience > 20000 THEN RAISE EXCEPTION 'The audience is larger than the fixture limit'; END IF;
 INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, source_event_key, qualification_key,
  rule_revision, season_key, evidence_sha256, xp_delta)
 SELECT 'DEVNET', p.passport_id, 'community:' || p_campaign || ':' || p_goal || ':' || p.passport_id, 'AWARD',
  'community:' || p_campaign || ':' || p_goal || ':' || p.passport_id, 'community-goal', goal.revision,
  'devnet-test-2026',
  encode(sha256(convert_to('community|' || p_campaign || '|' || p_goal || '|' || goal.revision, 'UTF8')), 'hex'),
  goal.xp_each
 FROM quest.passports p WHERE p.network = 'DEVNET'
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added = ROW_COUNT;
 INSERT INTO quest.manual_goal_completions (campaign_id, goal_id, completed_at, actor_wallet, note, xp_each, recipients)
 VALUES (p_campaign, p_goal, stamp, p_actor, NULLIF(btrim(p_note), ''), goal.xp_each, added);
 INSERT INTO quest.manual_goal_audit (campaign_id, goal_id, action, actor_wallet, detail)
 VALUES (p_campaign, p_goal, 'COMPLETE', p_actor, jsonb_build_object('xpEach', goal.xp_each, 'recipients', added));
 RETURN jsonb_build_object('campaignId', p_campaign, 'goalId', p_goal, 'xpEach', goal.xp_each, 'recipients', added);
END;
$$;
REVOKE ALL ON FUNCTION quest.complete_manual_goal(text, text, text, text) FROM PUBLIC;

-- ---- reads ------------------------------------------------------------------------------------------------
-- The operator's list: every goal of a campaign with its state.
CREATE FUNCTION quest.manual_goals_admin(p_campaign text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'goalId', g.goal_id, 'title', g.title, 'flavorText', g.flavor_text,
  'startsAt', g.starts_at, 'endsAt', g.ends_at, 'xpEach', g.xp_each, 'revision', g.revision,
  'status', CASE WHEN c.goal_id IS NOT NULL THEN 'COMPLETED'
                 WHEN clock_timestamp() < g.starts_at THEN 'UPCOMING'
                 WHEN clock_timestamp() >= g.ends_at THEN 'EXPIRED' ELSE 'ACTIVE' END,
  'completedAt', c.completed_at, 'recipients', c.recipients, 'note', c.note
 ) ORDER BY g.starts_at, g.goal_id), '[]'::jsonb)
 FROM quest.manual_goals g
 LEFT JOIN quest.manual_goal_completions c ON c.campaign_id = g.campaign_id AND c.goal_id = g.goal_id
 WHERE g.campaign_id = p_campaign;
$$;
REVOKE ALL ON FUNCTION quest.manual_goals_admin(text) FROM PUBLIC;

-- What a player sees: goals of the campaign that are open or recently decided, and whether they received the XP.
CREATE FUNCTION quest.community_goals_overview(p_passport uuid, p_campaign text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id', g.goal_id, 'title', g.title, 'flavorText', g.flavor_text,
  'startsAt', g.starts_at, 'endsAt', g.ends_at, 'xp', g.xp_each,
  'status', CASE WHEN c.goal_id IS NOT NULL THEN 'COMPLETED'
                 WHEN clock_timestamp() < g.starts_at THEN 'UPCOMING'
                 WHEN clock_timestamp() >= g.ends_at THEN 'EXPIRED' ELSE 'ACTIVE' END,
  'completedAt', c.completed_at,
  'received', EXISTS (SELECT 1 FROM quest.xp_events e WHERE e.network = 'DEVNET' AND e.passport_id = p_passport
                      AND e.qualification_key = 'community-goal'
                      AND e.source_event_key = 'community:' || g.campaign_id || ':' || g.goal_id || ':' || p_passport)
 ) ORDER BY g.starts_at, g.goal_id), '[]'::jsonb)
 FROM quest.manual_goals g
 LEFT JOIN quest.manual_goal_completions c ON c.campaign_id = g.campaign_id AND c.goal_id = g.goal_id
 WHERE g.campaign_id = p_campaign
  AND g.ends_at > clock_timestamp() - interval '45 days'
  AND g.starts_at < clock_timestamp() + interval '45 days';
$$;
REVOKE ALL ON FUNCTION quest.community_goals_overview(uuid, text) FROM PUBLIC;

COMMIT;
