-- Clans v2: clans rally votes for chosen pools. They never pool or delegate voting power and never pool XP.
--
-- * vote_allocations: which gauges each observed vote put weight on (the worker already decodes them; migration 020 only
--   kept the count). Latest read per vote account, replaced each round, readable only through the functions below.
-- * clan_rallies: up to three pools a clan leader asks members to back.
-- * The clan board ranks clans by how many members voted for a rally pool this epoch. Member XP stays personal.

CREATE TABLE quest.vote_allocations (
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 epoch_id bigint NOT NULL CHECK (epoch_id >= 0),
 vote_account text NOT NULL CHECK (length(vote_account) BETWEEN 32 AND 44 AND vote_account ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 gauge text NOT NULL CHECK (length(gauge) BETWEEN 32 AND 44 AND gauge ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 weight numeric(20,0) NOT NULL CHECK (weight > 0),
 PRIMARY KEY (network, epoch_id, vote_account, gauge)
);
CREATE INDEX vote_allocations_by_gauge ON quest.vote_allocations (network, epoch_id, gauge);
REVOKE ALL ON quest.vote_allocations FROM PUBLIC;

CREATE TABLE quest.clan_rallies (
 rally_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clan_id uuid NOT NULL REFERENCES quest.clans (clan_id),
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 gauge text NOT NULL CHECK (length(gauge) BETWEEN 32 AND 44 AND gauge ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 pool text NOT NULL CHECK (length(pool) BETWEEN 32 AND 44 AND pool ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 label text NOT NULL CHECK (label = btrim(label) AND length(label) BETWEEN 3 AND 40 AND label ~ '^[A-Za-z0-9][A-Za-z0-9 /_.-]*$'),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz
);
CREATE UNIQUE INDEX clan_rallies_live ON quest.clan_rallies (clan_id, gauge) WHERE removed_at IS NULL;
REVOKE ALL ON quest.clan_rallies FROM PUBLIC;

ALTER TABLE quest.clan_audit DROP CONSTRAINT clan_audit_action_check;
ALTER TABLE quest.clan_audit ADD CONSTRAINT clan_audit_action_check
 CHECK (action IN ('CREATE', 'JOIN', 'JOIN_INVITE', 'LEAVE', 'KICK', 'DISBAND', 'PROMOTE', 'INVITE', 'RALLY_ADD', 'RALLY_REMOVE'));

-- Does this passport have a vote (from a wallet it had linked at vote time) with weight on this gauge in this epoch?
CREATE FUNCTION quest.clan_member_backed(p_passport uuid, p_epoch bigint, p_gauge text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog,quest AS $$
 SELECT EXISTS (
  SELECT 1 FROM quest.vote_allocations a
  JOIN quest.vote_observations o
   ON o.network = a.network AND o.epoch_id = a.epoch_id AND o.vote_account = a.vote_account
  JOIN quest.wallet_links l
   ON l.network = o.network AND l.wallet = o.owner_wallet AND l.passport_id = p_passport
   AND l.linked_at <= o.vote_time AND (l.unlinked_at IS NULL OR l.unlinked_at > o.vote_time)
  WHERE a.network = 'DEVNET' AND a.epoch_id = p_epoch AND a.gauge = p_gauge);
$$;
REVOKE ALL ON FUNCTION quest.clan_member_backed(uuid, bigint, text) FROM PUBLIC;

-- How many active members backed this clan's rally pools this epoch. Counts a member once however many rallies they back.
CREATE FUNCTION quest.clan_rally_voters(p_clan uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,quest AS $$
DECLARE head bigint; n integer;
BEGIN
 SELECT max(h.epoch_id) INTO head FROM quest.vote_epoch_heads h WHERE h.network = 'DEVNET';
 IF head IS NULL THEN RETURN 0; END IF;
 SELECT count(*)::int INTO n FROM quest.clan_members m
 WHERE m.clan_id = p_clan AND m.left_at IS NULL AND EXISTS (
  SELECT 1 FROM quest.clan_rallies y
  WHERE y.clan_id = p_clan AND y.removed_at IS NULL AND quest.clan_member_backed(m.passport_id, head, y.gauge));
 RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_rally_voters(uuid) FROM PUBLIC;

-- The clan's live rally pools with this epoch's aggregate: members who backed each. Hidden under the privacy floor.
CREATE FUNCTION quest.clan_rallies_json(p_clan uuid, p_min integer, p_members integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,quest AS $$
DECLARE head bigint; show boolean;
BEGIN
 SELECT max(h.epoch_id) INTO head FROM quest.vote_epoch_heads h WHERE h.network = 'DEVNET';
 show := head IS NOT NULL AND p_members >= p_min;
 RETURN COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'gauge', y.gauge, 'pool', y.pool, 'label', y.label, 'since', y.created_at,
    'backed', CASE WHEN show THEN (
      SELECT count(*)::int FROM quest.clan_members m
      WHERE m.clan_id = p_clan AND m.left_at IS NULL AND quest.clan_member_backed(m.passport_id, head, y.gauge)) ELSE NULL END,
    'members', p_members) ORDER BY y.created_at)
  FROM quest.clan_rallies y WHERE y.clan_id = p_clan AND y.removed_at IS NULL), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_rallies_json(uuid, integer, integer) FROM PUBLIC;

-- Leader only. Returns OK, INVALID, NOT_IN_CLAN, FORBIDDEN, LIMIT or EXISTS.
CREATE FUNCTION quest.clan_rally(p_passport uuid, p_gauge text, p_pool text, p_label text, p_on boolean) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE m quest.clan_members%ROWTYPE; lbl text := btrim(COALESCE(p_label, '')); live integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 SELECT * INTO m FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_IN_CLAN'; END IF;
 IF m.role <> 'LEADER' THEN RETURN 'FORBIDDEN'; END IF;
 IF p_gauge IS NULL OR length(p_gauge) NOT BETWEEN 32 AND 44 OR p_gauge !~ '^[1-9A-HJ-NP-Za-km-z]+$' THEN RETURN 'INVALID'; END IF;
 IF p_on THEN
  IF p_pool IS NULL OR length(p_pool) NOT BETWEEN 32 AND 44 OR p_pool !~ '^[1-9A-HJ-NP-Za-km-z]+$'
     OR length(lbl) NOT BETWEEN 3 AND 40 OR lbl !~ '^[A-Za-z0-9][A-Za-z0-9 /_.-]*$' THEN RETURN 'INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM quest.clan_rallies WHERE clan_id = m.clan_id AND gauge = p_gauge AND removed_at IS NULL) THEN RETURN 'EXISTS'; END IF;
  SELECT count(*)::int INTO live FROM quest.clan_rallies WHERE clan_id = m.clan_id AND removed_at IS NULL;
  IF live >= 3 THEN RETURN 'LIMIT'; END IF;
  INSERT INTO quest.clan_rallies (clan_id, gauge, pool, label, created_by) VALUES (m.clan_id, p_gauge, p_pool, lbl, p_passport);
  INSERT INTO quest.clan_audit (clan_id, passport_id, action, detail) VALUES (m.clan_id, p_passport, 'RALLY_ADD', jsonb_build_object('gauge', p_gauge, 'label', lbl));
 ELSE
  UPDATE quest.clan_rallies SET removed_at = now() WHERE clan_id = m.clan_id AND gauge = p_gauge AND removed_at IS NULL;
  IF NOT FOUND THEN RETURN 'INVALID'; END IF;
  INSERT INTO quest.clan_audit (clan_id, passport_id, action, detail) VALUES (m.clan_id, p_passport, 'RALLY_REMOVE', jsonb_build_object('gauge', p_gauge));
 END IF;
 RETURN 'OK';
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_rally(uuid, text, text, text, boolean) FROM PUBLIC;

-- The clan board now ranks by rally voters this epoch (members who backed a rally pool); XP columns stay per-member.
CREATE OR REPLACE FUNCTION quest.clan_standings() RETURNS TABLE (
 clan_id uuid, member_count integer, active_members integer, season_xp bigint, week_xp bigint,
 per_active numeric, rank integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,quest AS $$
BEGIN
 RETURN QUERY
 WITH agg AS (
  SELECT c.clan_id, c.created_at,
   count(*) FILTER (WHERE r.active)::int AS member_count,
   count(*) FILTER (WHERE r.active AND r.xp > 0)::int AS active_members,
   quest.clan_rally_voters(c.clan_id)::bigint AS rally_voters,
   COALESCE(sum(r.week_xp), 0)::bigint AS week_xp
  FROM quest.clans c
  CROSS JOIN LATERAL quest.clan_member_rows(c.clan_id) r
  WHERE c.disbanded_at IS NULL
  GROUP BY c.clan_id, c.created_at)
 SELECT a.clan_id, a.member_count, a.active_members, a.rally_voters, a.week_xp,
  round(a.rally_voters::numeric / greatest(a.member_count, 1), 2),
  (row_number() OVER (ORDER BY a.rally_voters DESC, a.member_count DESC, a.created_at ASC, a.clan_id))::int
 FROM agg a
 WHERE a.member_count > 0;
END;
$$;

-- Your clan, now with its rally pools.
CREATE OR REPLACE FUNCTION quest.clan_overview(p_passport uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.clan_rules%ROWTYPE; s quest.clan_seasons%ROWTYPE; m quest.clan_members%ROWTYPE; c quest.clans%ROWTYPE;
 st record; clan_json jsonb := NULL; members_json jsonb; voted_n integer; invite text; live_count integer; head bigint;
BEGIN
 SELECT * INTO r FROM quest.clan_rules;
 SELECT * INTO s FROM quest.clan_seasons WHERE starts_at <= now() ORDER BY starts_at DESC LIMIT 1;
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 SELECT count(*)::int INTO live_count FROM quest.clans WHERE disbanded_at IS NULL;
 SELECT * INTO m FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NULL;
 IF FOUND THEN
  SELECT * INTO c FROM quest.clans WHERE clan_id = m.clan_id;
  SELECT * INTO st FROM quest.clan_standings() x WHERE x.clan_id = m.clan_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref', x.member_ref, 'alias', quest.clan_alias(x.passport_id), 'role', x.role,
    'xp', x.xp, 'weekXp', x.week_xp, 'joinedAt', x.joined_at, 'isMe', (x.passport_id = p_passport))
    ORDER BY x.xp DESC, x.joined_at), '[]'::jsonb),
   count(*) FILTER (WHERE x.voted)::int
  INTO members_json, voted_n
  FROM quest.clan_member_rows(m.clan_id) x WHERE x.active;
  IF m.role = 'LEADER' THEN
   SELECT code INTO invite FROM quest.clan_invites
   WHERE clan_id = m.clan_id AND expires_at > now() AND uses < max_uses ORDER BY created_at DESC LIMIT 1;
  END IF;
  SELECT max(h.epoch_id) INTO head FROM quest.vote_epoch_heads h WHERE h.network = 'DEVNET';
  clan_json := jsonb_build_object(
   'id', c.clan_id, 'name', c.name, 'tag', c.tag, 'role', m.role, 'myRef', m.member_ref,
   'createdAt', c.created_at, 'rank', st.rank, 'members', st.member_count, 'activeMembers', st.active_members,
   'seasonXp', st.season_xp, 'weekXp', st.week_xp, 'score', st.season_xp, 'perActive', st.per_active,
   'membersList', members_json, 'invite', invite,
   'rallies', quest.clan_rallies_json(m.clan_id, r.min_voters_shown, st.member_count),
   'voting', CASE WHEN head IS NOT NULL AND st.member_count >= r.min_voters_shown
                  THEN jsonb_build_object('epoch', head, 'voted', voted_n, 'members', st.member_count) ELSE NULL END);
 END IF;
 RETURN jsonb_build_object(
  'eligible', quest.clan_eligible(p_passport),
  'maxMembers', r.max_members,
  'clanCount', live_count,
  'season', CASE WHEN s.season_key IS NULL THEN NULL
                 ELSE jsonb_build_object('key', s.season_key, 'label', s.label, 'startsAt', s.starts_at, 'endsAt', s.ends_at) END,
  'clan', clan_json);
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_overview(uuid) FROM PUBLIC;
