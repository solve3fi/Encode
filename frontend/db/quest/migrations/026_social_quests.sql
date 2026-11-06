-- Devnet TEST one-time social quests: follow Solve3 on X, send the prewritten X post, join the Discord server.
-- X and Discord cannot be checked from the chain, so these are honor claims: the player does the thing, then claims
-- the XP once. They are small on purpose (100 XP each) and every claim is an append-only row, so the team can
-- spot-check and see exactly who claimed what and when. The award goes through the same xp_events ledger as every
-- other award, and the community-xp pause switch (migration 024) stops claims. Append-only upgrade of 001..025.
BEGIN;

CREATE TABLE quest.social_quest_rules (
 quest_key text PRIMARY KEY CHECK (quest_key IN ('follow-x', 'post-x', 'join-discord')),
 xp integer NOT NULL CHECK (xp BETWEEN 1 AND 100000),
 rule_revision integer NOT NULL DEFAULT 1 CHECK (rule_revision > 0),
 season_key text NOT NULL CHECK (season_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
 description text NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
 action_label text NOT NULL CHECK (length(action_label) BETWEEN 1 AND 40),
 action_url text NOT NULL CHECK (action_url ~ '^https://[^[:space:]]+$' AND length(action_url) <= 600),
 post_text text CHECK (post_text IS NULL OR length(post_text) BETWEEN 1 AND 280)
);
REVOKE ALL ON quest.social_quest_rules FROM PUBLIC;
INSERT INTO quest.social_quest_rules (quest_key, xp, season_key, title, description, action_label, action_url, post_text) VALUES
 ('follow-x', 100, 'devnet-test-2026', 'Become a number',
  'Follow @solve3fi on X. We''ll treat you as more than a number, but the number does go up.',
  'Open X', 'https://x.com/solve3fi', NULL),
 ('post-x', 100, 'devnet-test-2026', 'Brag responsibly',
  'Send the ready-made post from your X account. Bragging is encouraged, financial advice is not.',
  'Post on X',
  'https://x.com/intent/post?text=Step%20one%3A%20lock%20tokens.%20Step%20two%3A%20vote%20on%20pools.%20Step%20three%3A%20watch%20liquidity%20sprint%20toward%20the%20rewards%20like%20it%27s%20never%20seen%20money.%20Step%20four%3A%20take%20full%20credit.%20%40solve3fi%20https%3A%2F%2Fsolve3.fi%2Fquests',
  'Step one: lock tokens. Step two: vote on pools. Step three: watch liquidity sprint toward the rewards like it''s never seen money. Step four: take full credit. @solve3fi https://solve3.fi/quests'),
 ('join-discord', 100, 'devnet-test-2026', 'Find the safe room',
  'Join the Solve3 Discord. Snacks not guaranteed, bug reports welcome.',
  'Join Discord', 'https://discord.gg/ZDyXeyjGc7', NULL);
CREATE FUNCTION quest.guard_social_quests() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'Social quest rules and claims are append-only; change a rule through a reviewed migration';
END;
$$;
CREATE TRIGGER social_quest_rules_immutable BEFORE UPDATE OR DELETE ON quest.social_quest_rules
 FOR EACH ROW EXECUTE FUNCTION quest.guard_social_quests();
CREATE TRIGGER social_quest_rules_no_truncate BEFORE TRUNCATE ON quest.social_quest_rules
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_social_quests();

CREATE TABLE quest.social_quest_claims (
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 passport_id uuid NOT NULL,
 quest_key text NOT NULL REFERENCES quest.social_quest_rules (quest_key),
 xp integer NOT NULL CHECK (xp > 0),
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (passport_id, quest_key),
 FOREIGN KEY (network, passport_id) REFERENCES quest.passports (network, passport_id)
);
REVOKE ALL ON quest.social_quest_claims FROM PUBLIC;
CREATE TRIGGER social_quest_claims_immutable BEFORE UPDATE OR DELETE ON quest.social_quest_claims
 FOR EACH ROW EXECUTE FUNCTION quest.guard_social_quests();
CREATE TRIGGER social_quest_claims_no_truncate BEFORE TRUNCATE ON quest.social_quest_claims
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_social_quests();

-- Claim one social quest, once per Passport. Returns OK, or ALREADY when it was claimed before.
CREATE FUNCTION quest.claim_social_quest(p_passport uuid, p_quest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.social_quest_rules; n integer;
BEGIN
 IF quest.pause_enabled('community-xp') THEN RAISE EXCEPTION 'Community XP is paused'; END IF;
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 SELECT * INTO r FROM quest.social_quest_rules WHERE quest_key = p_quest;
 IF r.quest_key IS NULL THEN RAISE EXCEPTION 'Unknown social quest'; END IF;
 -- Calendar operator identities are not players.
 IF EXISTS (SELECT 1 FROM quest.calendar_operator_grants g WHERE g.network = 'DEVNET' AND g.passport_id = p_passport) THEN
  RAISE EXCEPTION 'Operators do not earn social quest XP';
 END IF;
 INSERT INTO quest.social_quest_claims (passport_id, quest_key, xp) VALUES (p_passport, p_quest, r.xp) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n = 0 THEN RETURN jsonb_build_object('result', 'ALREADY'); END IF;
 INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, source_event_key, qualification_key,
  rule_revision, season_key, evidence_sha256, xp_delta)
 VALUES ('DEVNET', p_passport, 'social:' || p_quest || ':' || p_passport, 'AWARD', 'social:' || p_passport, 'social-' || p_quest,
  r.rule_revision, r.season_key, encode(sha256(convert_to('social|' || p_quest || '|' || p_passport, 'UTF8')), 'hex'), r.xp)
 ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('result', 'OK', 'xp', r.xp);
END;
$$;
REVOKE ALL ON FUNCTION quest.claim_social_quest(uuid, text) FROM PUBLIC;

-- A Passport's own view of the three quests.
CREATE FUNCTION quest.social_quests_overview(p_passport uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'key', r.quest_key, 'title', r.title, 'description', r.description, 'xp', r.xp,
  'actionLabel', r.action_label, 'actionUrl', r.action_url, 'postText', r.post_text,
  'claimedAt', c.claimed_at
 ) ORDER BY CASE r.quest_key WHEN 'follow-x' THEN 1 WHEN 'post-x' THEN 2 ELSE 3 END), '[]'::jsonb)
 FROM quest.social_quest_rules r
 LEFT JOIN quest.social_quest_claims c ON c.passport_id = p_passport AND c.quest_key = r.quest_key;
$$;
REVOKE ALL ON FUNCTION quest.social_quests_overview(uuid) FROM PUBLIC;

COMMIT;
