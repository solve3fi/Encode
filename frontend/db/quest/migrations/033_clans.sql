-- Devnet TEST clans. A clan is a scoring and social group: it never pools, delegates or adds voting power.
-- Append-only upgrade of 001..032.
--
-- Trust: the browser never writes anything. Every table below is closed to the serving roles; only the SECURITY
-- DEFINER functions at the end read or write them, and none of them returns another Passport's id. Members are shown
-- by a per-clan member_ref and a short derived alias. Clan score v1 is the quest XP a Passport earned WHILE it was a
-- member and inside the season window (swap and liquidity quests already pay XP, so both count). XP earned before
-- joining never moves with the member, so hopping between clans cannot carry a score over. A cooldown applies after
-- leaving. Joining needs a minted Pass or a vote from a linked wallet (a veSOLV3 lock).
BEGIN;

CREATE TABLE quest.clan_rules (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 max_members integer NOT NULL CHECK (max_members BETWEEN 2 AND 200),
 min_voters_shown integer NOT NULL CHECK (min_voters_shown BETWEEN 1 AND 50),
 rejoin_cooldown_hours integer NOT NULL CHECK (rejoin_cooldown_hours BETWEEN 0 AND 168),
 invite_days integer NOT NULL CHECK (invite_days BETWEEN 1 AND 60),
 invite_max_uses integer NOT NULL CHECK (invite_max_uses BETWEEN 1 AND 100),
 rule_revision integer NOT NULL CHECK (rule_revision > 0)
);
REVOKE ALL ON quest.clan_rules FROM PUBLIC;
INSERT INTO quest.clan_rules (max_members, min_voters_shown, rejoin_cooldown_hours, invite_days, invite_max_uses, rule_revision)
VALUES (50, 3, 1, 14, 25, 1);

CREATE FUNCTION quest.guard_clan_rows() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'Clan rule, season and audit rows are append-only; add a new revision through a reviewed migration';
END;
$$;
CREATE TRIGGER clan_rules_immutable BEFORE UPDATE OR DELETE ON quest.clan_rules
 FOR EACH ROW EXECUTE FUNCTION quest.guard_clan_rows();
CREATE TRIGGER clan_rules_no_truncate BEFORE TRUNCATE ON quest.clan_rules
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_clan_rows();

CREATE TABLE quest.clan_seasons (
 season_key text PRIMARY KEY CHECK (season_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 label text NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 CHECK (ends_at > starts_at)
);
REVOKE ALL ON quest.clan_seasons FROM PUBLIC;
INSERT INTO quest.clan_seasons (season_key, label, starts_at, ends_at)
VALUES ('season-1', 'Season 1', now(), now() + interval '90 days');
CREATE TRIGGER clan_seasons_immutable BEFORE UPDATE OR DELETE ON quest.clan_seasons
 FOR EACH ROW EXECUTE FUNCTION quest.guard_clan_rows();
CREATE TRIGGER clan_seasons_no_truncate BEFORE TRUNCATE ON quest.clan_seasons
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_clan_rows();

CREATE TABLE quest.clans (
 clan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 3 AND 24 AND name ~ '^[A-Za-z0-9][A-Za-z0-9 _.-]*$'),
 tag text NOT NULL CHECK (tag ~ '^[A-Z0-9]{3,4}$'),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 disbanded_at timestamptz,
 FOREIGN KEY (network, created_by) REFERENCES quest.passports (network, passport_id)
);
CREATE UNIQUE INDEX clans_name_live ON quest.clans (lower(name)) WHERE disbanded_at IS NULL;
CREATE UNIQUE INDEX clans_tag_live ON quest.clans (tag) WHERE disbanded_at IS NULL;
REVOKE ALL ON quest.clans FROM PUBLIC;

CREATE TABLE quest.clan_members (
 member_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 clan_id uuid NOT NULL REFERENCES quest.clans (clan_id),
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 passport_id uuid NOT NULL,
 role text NOT NULL CHECK (role IN ('LEADER', 'MEMBER')),
 joined_at timestamptz NOT NULL DEFAULT now(),
 left_at timestamptz,
 left_reason text CHECK (left_reason IS NULL OR left_reason IN ('LEFT', 'KICKED', 'DISBANDED')),
 CHECK ((left_at IS NULL) = (left_reason IS NULL)),
 FOREIGN KEY (network, passport_id) REFERENCES quest.passports (network, passport_id)
);
CREATE UNIQUE INDEX clan_members_one_active ON quest.clan_members (passport_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX clan_members_one_leader ON quest.clan_members (clan_id) WHERE left_at IS NULL AND role = 'LEADER';
CREATE INDEX clan_members_by_clan ON quest.clan_members (clan_id) WHERE left_at IS NULL;
CREATE INDEX clan_members_by_passport ON quest.clan_members (passport_id, left_at);
REVOKE ALL ON quest.clan_members FROM PUBLIC;

CREATE TABLE quest.clan_invites (
 code text PRIMARY KEY CHECK (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
 clan_id uuid NOT NULL REFERENCES quest.clans (clan_id),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
 uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses)
);
CREATE INDEX clan_invites_by_clan ON quest.clan_invites (clan_id, expires_at);
REVOKE ALL ON quest.clan_invites FROM PUBLIC;

CREATE TABLE quest.clan_audit (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 clan_id uuid,
 passport_id uuid NOT NULL,
 action text NOT NULL CHECK (action IN ('CREATE', 'JOIN', 'JOIN_INVITE', 'LEAVE', 'KICK', 'DISBAND', 'PROMOTE', 'INVITE')),
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON quest.clan_audit FROM PUBLIC;
CREATE TRIGGER clan_audit_immutable BEFORE UPDATE OR DELETE ON quest.clan_audit
 FOR EACH ROW EXECUTE FUNCTION quest.guard_clan_rows();
CREATE TRIGGER clan_audit_no_truncate BEFORE TRUNCATE ON quest.clan_audit
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_clan_rows();

-- ---------------------------------------------------------------- internal helpers (not granted to the serving roles)

-- A minted Pass, or a vote from a linked wallet (which needs a veSOLV3 lock).
CREATE FUNCTION quest.clan_eligible(p_passport uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,quest AS $$
BEGIN
 RETURN EXISTS (
   SELECT 1 FROM quest.xp_events e
   WHERE e.network = 'DEVNET' AND e.passport_id = p_passport AND e.kind = 'AWARD' AND e.qualification_key = 'mint-pass')
  OR EXISTS (
   SELECT 1 FROM quest.vote_observations o
   JOIN quest.wallet_links l
    ON l.network = o.network AND l.wallet = o.owner_wallet AND l.passport_id = p_passport
    AND l.linked_at <= o.vote_time AND (l.unlinked_at IS NULL OR l.unlinked_at > o.vote_time)
   WHERE o.network = 'DEVNET');
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_eligible(uuid) FROM PUBLIC;

-- Per member: the XP earned while a member and inside the current season window, and the last 7 days of it.
CREATE FUNCTION quest.clan_member_rows(p_clan uuid) RETURNS TABLE (
 member_ref uuid, passport_id uuid, role text, joined_at timestamptz, active boolean, xp bigint, week_xp bigint, voted boolean)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,quest AS $$
DECLARE s quest.clan_seasons%ROWTYPE; head bigint;
BEGIN
 SELECT * INTO s FROM quest.clan_seasons WHERE starts_at <= now() ORDER BY starts_at DESC LIMIT 1;
 SELECT max(h.epoch_id) INTO head FROM quest.vote_epoch_heads h WHERE h.network = 'DEVNET';
 RETURN QUERY
 SELECT m.member_ref, m.passport_id, m.role, m.joined_at, (m.left_at IS NULL) AS active,
  COALESCE((SELECT sum(e.xp_delta) FROM quest.xp_events e
            WHERE e.network = 'DEVNET' AND e.passport_id = m.passport_id
              AND e.recorded_at >= greatest(m.joined_at, s.starts_at)
              AND e.recorded_at < least(COALESCE(m.left_at, now()), s.ends_at, now())), 0)::bigint AS xp,
  COALESCE((SELECT sum(e.xp_delta) FROM quest.xp_events e
            WHERE e.network = 'DEVNET' AND e.passport_id = m.passport_id
              AND e.recorded_at >= greatest(m.joined_at, s.starts_at, now() - interval '7 days')
              AND e.recorded_at < least(COALESCE(m.left_at, now()), s.ends_at, now())), 0)::bigint AS week_xp,
  (head IS NOT NULL AND m.left_at IS NULL AND EXISTS (
    SELECT 1 FROM quest.vote_observations o
    JOIN quest.wallet_links l
     ON l.network = o.network AND l.wallet = o.owner_wallet AND l.passport_id = m.passport_id
     AND l.linked_at <= o.vote_time AND (l.unlinked_at IS NULL OR l.unlinked_at > o.vote_time)
    WHERE o.network = 'DEVNET' AND o.epoch_id = head)) AS voted
 FROM quest.clan_members m
 WHERE m.clan_id = p_clan AND s.season_key IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_member_rows(uuid) FROM PUBLIC;

-- Every live clan with its season score and rank. Rank: score, then members, then age.
CREATE FUNCTION quest.clan_standings() RETURNS TABLE (
 clan_id uuid, member_count integer, active_members integer, season_xp bigint, week_xp bigint,
 per_active numeric, rank integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,quest AS $$
BEGIN
 RETURN QUERY
 WITH agg AS (
  SELECT c.clan_id, c.created_at,
   count(*) FILTER (WHERE r.active)::int AS member_count,
   count(*) FILTER (WHERE r.active AND r.xp > 0)::int AS active_members,
   COALESCE(sum(r.xp), 0)::bigint AS season_xp,
   COALESCE(sum(r.week_xp), 0)::bigint AS week_xp
  FROM quest.clans c
  CROSS JOIN LATERAL quest.clan_member_rows(c.clan_id) r
  WHERE c.disbanded_at IS NULL
  GROUP BY c.clan_id, c.created_at)
 SELECT a.clan_id, a.member_count, a.active_members, a.season_xp, a.week_xp,
  round(a.season_xp::numeric / greatest(a.active_members, 1), 1),
  (row_number() OVER (ORDER BY a.season_xp DESC, a.member_count DESC, a.created_at ASC, a.clan_id))::int
 FROM agg a
 WHERE a.member_count > 0;
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_standings() FROM PUBLIC;

CREATE FUNCTION quest.clan_alias(p_passport uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT 'Member ' || upper(substr(md5('clan-alias:' || p_passport::text), 1, 4));
$$;
REVOKE ALL ON FUNCTION quest.clan_alias(uuid) FROM PUBLIC;

CREATE FUNCTION quest.clan_fresh_code() RETURNS text
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
 FROM generate_series(1, 8);
$$;
REVOKE ALL ON FUNCTION quest.clan_fresh_code() FROM PUBLIC;

-- ---------------------------------------------------------------- functions the serving roles may execute

-- Your clan (or none), eligibility, the season and the rules. Never returns another Passport id.
CREATE FUNCTION quest.clan_overview(p_passport uuid) RETURNS jsonb
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

-- The board: live clans by rank, with an optional name or tag search. Callable by any signed-in Passport.
CREATE FUNCTION quest.clan_board(p_passport uuid, p_query text, p_limit integer, p_offset integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.clan_rules%ROWTYPE; q text := lower(btrim(COALESCE(p_query, ''))); rows_json jsonb; total integer; mine uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 OR p_offset IS NULL OR p_offset < 0 OR length(q) > 24 THEN
  RAISE EXCEPTION 'Invalid clan board request';
 END IF;
 SELECT * INTO r FROM quest.clan_rules;
 SELECT clan_id INTO mine FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NULL;
 SELECT count(*)::int INTO total
 FROM quest.clan_standings() s JOIN quest.clans c ON c.clan_id = s.clan_id
 WHERE q = '' OR lower(c.name) LIKE '%' || replace(replace(q, '%', ''), '_', '') || '%' OR lower(c.tag) = q;
 SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.rank), '[]'::jsonb) INTO rows_json FROM (
  SELECT c.clan_id AS id, c.name, c.tag, s.rank, s.member_count AS members, r.max_members AS "maxMembers",
   s.season_xp AS score, s.week_xp AS "weekXp", s.per_active AS "perActive", (c.clan_id = mine) AS "isMine"
  FROM quest.clan_standings() s JOIN quest.clans c ON c.clan_id = s.clan_id
  WHERE q = '' OR lower(c.name) LIKE '%' || replace(replace(q, '%', ''), '_', '') || '%' OR lower(c.tag) = q
  ORDER BY s.rank LIMIT p_limit OFFSET p_offset) t;
 RETURN jsonb_build_object('total', total, 'clans', rows_json);
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_board(uuid, text, integer, integer) FROM PUBLIC;

-- Create a clan and lead it. Returns OK, INVALID, NOT_ELIGIBLE, ALREADY_IN_CLAN, COOLDOWN, NAME_TAKEN or TAG_TAKEN.
CREATE FUNCTION quest.clan_create(p_passport uuid, p_name text, p_tag text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.clan_rules%ROWTYPE; n text := btrim(COALESCE(p_name, '')); t text := upper(btrim(COALESCE(p_tag, ''))); new_id uuid; last_left timestamptz;
BEGIN
 SELECT * INTO r FROM quest.clan_rules;
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 IF length(n) NOT BETWEEN 3 AND 24 OR n !~ '^[A-Za-z0-9][A-Za-z0-9 _.-]*$' OR t !~ '^[A-Z0-9]{3,4}$' THEN RETURN 'INVALID'; END IF;
 IF EXISTS (SELECT 1 FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NULL) THEN RETURN 'ALREADY_IN_CLAN'; END IF;
 IF NOT quest.clan_eligible(p_passport) THEN RETURN 'NOT_ELIGIBLE'; END IF;
 SELECT max(left_at) INTO last_left FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NOT NULL;
 IF last_left IS NOT NULL AND last_left > now() - make_interval(hours => r.rejoin_cooldown_hours) THEN RETURN 'COOLDOWN'; END IF;
 IF EXISTS (SELECT 1 FROM quest.clans WHERE disbanded_at IS NULL AND lower(name) = lower(n)) THEN RETURN 'NAME_TAKEN'; END IF;
 IF EXISTS (SELECT 1 FROM quest.clans WHERE disbanded_at IS NULL AND tag = t) THEN RETURN 'TAG_TAKEN'; END IF;
 BEGIN
  INSERT INTO quest.clans (name, tag, created_by) VALUES (n, t, p_passport) RETURNING clan_id INTO new_id;
  INSERT INTO quest.clan_members (clan_id, passport_id, role) VALUES (new_id, p_passport, 'LEADER');
 EXCEPTION WHEN unique_violation THEN
  RETURN 'NAME_TAKEN';
 END;
 INSERT INTO quest.clan_audit (clan_id, passport_id, action, detail) VALUES (new_id, p_passport, 'CREATE', jsonb_build_object('name', n, 'tag', t));
 RETURN 'OK';
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_create(uuid, text, text) FROM PUBLIC;

-- Join by clan id or by invite code (exactly one). Returns OK, INVALID, NOT_FOUND, NOT_ELIGIBLE, ALREADY_IN_CLAN, COOLDOWN or FULL.
CREATE FUNCTION quest.clan_join(p_passport uuid, p_clan uuid, p_code text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.clan_rules%ROWTYPE; target uuid := p_clan; the_code text := upper(btrim(COALESCE(p_code, ''))); inv quest.clan_invites%ROWTYPE;
 last_left timestamptz; via_invite boolean := false; c quest.clans%ROWTYPE;
BEGIN
 SELECT * INTO r FROM quest.clan_rules;
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 IF (p_clan IS NULL) = (the_code = '') THEN RETURN 'INVALID'; END IF;
 IF the_code <> '' THEN
  IF the_code !~ '^[A-HJ-NP-Z2-9]{8}$' THEN RETURN 'INVALID'; END IF;
  SELECT i.* INTO inv FROM quest.clan_invites i WHERE i.code = the_code FOR UPDATE;
  IF NOT FOUND OR inv.expires_at <= now() OR inv.uses >= inv.max_uses THEN RETURN 'NOT_FOUND'; END IF;
  target := inv.clan_id;
  via_invite := true;
 END IF;
 -- Lock the clan so two joins cannot both take the last slot.
 SELECT * INTO c FROM quest.clans WHERE clan_id = target AND disbanded_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF EXISTS (SELECT 1 FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NULL) THEN RETURN 'ALREADY_IN_CLAN'; END IF;
 IF NOT quest.clan_eligible(p_passport) THEN RETURN 'NOT_ELIGIBLE'; END IF;
 SELECT max(left_at) INTO last_left FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NOT NULL;
 IF last_left IS NOT NULL AND last_left > now() - make_interval(hours => r.rejoin_cooldown_hours) THEN RETURN 'COOLDOWN'; END IF;
 IF (SELECT count(*) FROM quest.clan_members WHERE clan_id = target AND left_at IS NULL) >= r.max_members THEN RETURN 'FULL'; END IF;
 BEGIN
  INSERT INTO quest.clan_members (clan_id, passport_id, role) VALUES (target, p_passport, 'MEMBER');
 EXCEPTION WHEN unique_violation THEN
  RETURN 'ALREADY_IN_CLAN';
 END;
 IF via_invite THEN UPDATE quest.clan_invites SET uses = uses + 1 WHERE code = the_code; END IF;
 INSERT INTO quest.clan_audit (clan_id, passport_id, action, detail)
 VALUES (target, p_passport, CASE WHEN via_invite THEN 'JOIN_INVITE' ELSE 'JOIN' END, '{}'::jsonb);
 RETURN 'OK';
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_join(uuid, uuid, text) FROM PUBLIC;

-- Leave your clan. A leaving leader hands over to the longest-serving member; the last member disbands it.
-- Returns OK or NOT_IN_CLAN.
CREATE FUNCTION quest.clan_leave(p_passport uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE m quest.clan_members%ROWTYPE; heir uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 SELECT * INTO m FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_IN_CLAN'; END IF;
 PERFORM 1 FROM quest.clans WHERE clan_id = m.clan_id FOR UPDATE;
 IF m.role = 'LEADER' THEN
  SELECT member_ref INTO heir FROM quest.clan_members
  WHERE clan_id = m.clan_id AND left_at IS NULL AND member_ref <> m.member_ref ORDER BY joined_at, member_ref LIMIT 1;
  UPDATE quest.clan_members SET left_at = now(), left_reason = 'LEFT', role = 'MEMBER' WHERE member_ref = m.member_ref;
  IF heir IS NULL THEN
   UPDATE quest.clans SET disbanded_at = now() WHERE clan_id = m.clan_id;
   INSERT INTO quest.clan_audit (clan_id, passport_id, action) VALUES (m.clan_id, p_passport, 'DISBAND');
  ELSE
   UPDATE quest.clan_members SET role = 'LEADER' WHERE member_ref = heir;
   INSERT INTO quest.clan_audit (clan_id, passport_id, action, detail)
   VALUES (m.clan_id, p_passport, 'PROMOTE', jsonb_build_object('member_ref', heir));
  END IF;
 ELSE
  UPDATE quest.clan_members SET left_at = now(), left_reason = 'LEFT' WHERE member_ref = m.member_ref;
 END IF;
 INSERT INTO quest.clan_audit (clan_id, passport_id, action) VALUES (m.clan_id, p_passport, 'LEAVE');
 RETURN 'OK';
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_leave(uuid) FROM PUBLIC;

-- The clan's invite link code (leader only; reuses a live code). Returns the code, FORBIDDEN or NOT_IN_CLAN.
CREATE FUNCTION quest.clan_invite(p_passport uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.clan_rules%ROWTYPE; m quest.clan_members%ROWTYPE; existing text; fresh text; attempts integer := 0;
BEGIN
 SELECT * INTO r FROM quest.clan_rules;
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 SELECT * INTO m FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NULL;
 IF NOT FOUND THEN RETURN 'NOT_IN_CLAN'; END IF;
 IF m.role <> 'LEADER' THEN RETURN 'FORBIDDEN'; END IF;
 PERFORM 1 FROM quest.clans WHERE clan_id = m.clan_id FOR UPDATE;
 SELECT code INTO existing FROM quest.clan_invites
 WHERE clan_id = m.clan_id AND expires_at > now() AND uses < max_uses ORDER BY created_at DESC LIMIT 1;
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 WHILE fresh IS NULL AND attempts < 20 LOOP
  attempts := attempts + 1;
  BEGIN
   INSERT INTO quest.clan_invites (code, clan_id, created_by, expires_at, max_uses)
   VALUES (quest.clan_fresh_code(), m.clan_id, p_passport, now() + make_interval(days => r.invite_days), r.invite_max_uses)
   RETURNING code INTO fresh;
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
 END LOOP;
 IF fresh IS NULL THEN RAISE EXCEPTION 'Clan invite unavailable'; END IF;
 INSERT INTO quest.clan_audit (clan_id, passport_id, action) VALUES (m.clan_id, p_passport, 'INVITE');
 RETURN fresh;
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_invite(uuid) FROM PUBLIC;

-- Remove a member (leader only, never yourself). Returns OK, FORBIDDEN, NOT_IN_CLAN or NOT_FOUND.
CREATE FUNCTION quest.clan_kick(p_passport uuid, p_member_ref uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE me quest.clan_members%ROWTYPE; target quest.clan_members%ROWTYPE;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM quest.passports WHERE network = 'DEVNET' AND passport_id = p_passport) THEN
  RAISE EXCEPTION 'Unknown Passport';
 END IF;
 SELECT * INTO me FROM quest.clan_members WHERE passport_id = p_passport AND left_at IS NULL;
 IF NOT FOUND THEN RETURN 'NOT_IN_CLAN'; END IF;
 IF me.role <> 'LEADER' THEN RETURN 'FORBIDDEN'; END IF;
 PERFORM 1 FROM quest.clans WHERE clan_id = me.clan_id FOR UPDATE;
 SELECT * INTO target FROM quest.clan_members
 WHERE member_ref = p_member_ref AND clan_id = me.clan_id AND left_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF target.member_ref = me.member_ref THEN RETURN 'FORBIDDEN'; END IF;
 UPDATE quest.clan_members SET left_at = now(), left_reason = 'KICKED' WHERE member_ref = target.member_ref;
 INSERT INTO quest.clan_audit (clan_id, passport_id, action, detail)
 VALUES (me.clan_id, p_passport, 'KICK', jsonb_build_object('member_ref', target.member_ref));
 RETURN 'OK';
END;
$$;
REVOKE ALL ON FUNCTION quest.clan_kick(uuid, uuid) FROM PUBLIC;

COMMIT;
