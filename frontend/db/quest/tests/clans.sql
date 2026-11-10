-- Clan behaviour test. Run as the schema owner in a DISPOSABLE database after migrations 001..033.
-- Everything runs in one transaction that is rolled back. Inside one transaction now() is constant, so
-- membership start times are moved back with UPDATE to test the "XP counts only while a member" rule.
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE t (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO t (name) SELECT 'P' || n FROM generate_series(1, 60) n;
INSERT INTO quest.passports (passport_id) SELECT id FROM t;

CREATE FUNCTION pg_temp.pid(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t WHERE name = n $$;
CREATE FUNCTION pg_temp.award(n text, xp bigint, tag text, qual text, ago interval) RETURNS bigint LANGUAGE sql AS $$
 INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, source_event_key, qualification_key,
                              rule_revision, season_key, evidence_sha256, xp_delta, recorded_at)
 VALUES ('DEVNET', pg_temp.pid(n), 'test:' || tag, 'AWARD', 'test:' || tag, qual, 1, 'devnet-test-2026',
         encode(sha256(convert_to(tag, 'UTF8')), 'hex'), xp, now() - ago)
 RETURNING event_id $$;
-- A minted Pass makes a Passport eligible to create or join a clan.
CREATE FUNCTION pg_temp.eligible(n text) RETURNS void LANGUAGE sql AS $$
 SELECT pg_temp.award(n, 250, 'pass:' || n, 'mint-pass', interval '10 days') $$;

DO $$
DECLARE o jsonb; b jsonb; res text; code text; ev bigint; i integer; leaked boolean; cid uuid; ref uuid; n integer;
BEGIN
 -- 1. not eligible without a Pass or a veSOLV3 vote
 ASSERT quest.clan_create(pg_temp.pid('P1'), 'Moon Cats', 'mcat') = 'NOT_ELIGIBLE', 'needs a Pass';
 FOR i IN 1..8 LOOP PERFORM pg_temp.eligible('P' || i); END LOOP;
 ASSERT (quest.clan_overview(pg_temp.pid('P1'))->>'eligible')::boolean, 'eligible after Pass';
 ASSERT NOT (quest.clan_overview(pg_temp.pid('P50'))->>'eligible')::boolean, 'not eligible without Pass';

 -- 2. creating a clan
 ASSERT quest.clan_create(pg_temp.pid('P1'), 'x', 'MCAT') = 'INVALID', 'name too short';
 ASSERT quest.clan_create(pg_temp.pid('P1'), 'Moon Cats', 'a!') = 'INVALID', 'bad tag';
 ASSERT quest.clan_create(pg_temp.pid('P1'), '-bad', 'MCAT') = 'INVALID', 'bad name start';
 ASSERT quest.clan_create(pg_temp.pid('P1'), 'Moon Cats', 'mcat') = 'OK', 'create (tag upper-cased)';
 ASSERT quest.clan_create(pg_temp.pid('P1'), 'Other Clan', 'OTH') = 'ALREADY_IN_CLAN', 'one clan each';
 ASSERT quest.clan_create(pg_temp.pid('P2'), 'moon cats', 'ZZZ') = 'NAME_TAKEN', 'name unique, case-insensitive';
 ASSERT quest.clan_create(pg_temp.pid('P2'), 'Other Clan', 'MCAT') = 'TAG_TAKEN', 'tag unique';
 o := quest.clan_overview(pg_temp.pid('P1'));
 cid := (o->'clan'->>'id')::uuid;
 ASSERT o->'clan'->>'tag' = 'MCAT' AND o->'clan'->>'role' = 'LEADER' AND (o->'clan'->>'members')::int = 1, 'leader view';

 -- 3. the board and search
 b := quest.clan_board(pg_temp.pid('P2'), '', 10, 0);
 ASSERT (b->>'total')::int = 1 AND b->'clans'->0->>'name' = 'Moon Cats' AND (b->'clans'->0->>'rank')::int = 1, 'board lists the clan';
 ASSERT (quest.clan_board(pg_temp.pid('P2'), 'moon', 10, 0)->>'total')::int = 1, 'search by name';
 ASSERT (quest.clan_board(pg_temp.pid('P2'), 'mcat', 10, 0)->>'total')::int = 1, 'search by tag';
 ASSERT (quest.clan_board(pg_temp.pid('P2'), 'zzz', 10, 0)->>'total')::int = 0, 'search miss';
 BEGIN PERFORM quest.clan_board(pg_temp.pid('P2'), '', 500, 0); ASSERT false, 'limit too large';
 EXCEPTION WHEN raise_exception THEN NULL; END;

 -- 4. joining: by id, by invite code, and the rules
 ASSERT quest.clan_join(pg_temp.pid('P2'), cid, NULL) = 'OK', 'join by id';
 ASSERT quest.clan_join(pg_temp.pid('P2'), cid, NULL) = 'ALREADY_IN_CLAN', 'only once';
 ASSERT quest.clan_join(pg_temp.pid('P50'), cid, NULL) = 'NOT_ELIGIBLE', 'join needs a Pass';
 ASSERT quest.clan_join(pg_temp.pid('P3'), NULL, NULL) = 'INVALID', 'needs a target';
 ASSERT quest.clan_join(pg_temp.pid('P3'), cid, 'AAAAAAAA') = 'INVALID', 'not both id and code';
 ASSERT quest.clan_join(pg_temp.pid('P3'), gen_random_uuid(), NULL) = 'NOT_FOUND', 'unknown clan';
 ASSERT quest.clan_join(pg_temp.pid('P3'), NULL, 'AAAAAAAA') = 'NOT_FOUND', 'unknown code';
 ASSERT quest.clan_join(pg_temp.pid('P3'), NULL, 'short') = 'INVALID', 'malformed code';
 ASSERT quest.clan_invite(pg_temp.pid('P2')) = 'FORBIDDEN', 'only the leader invites';
 ASSERT quest.clan_invite(pg_temp.pid('P40')) = 'NOT_IN_CLAN', 'invite needs a clan';
 code := quest.clan_invite(pg_temp.pid('P1'));
 ASSERT code ~ '^[A-HJ-NP-Z2-9]{8}$', 'invite format';
 ASSERT quest.clan_invite(pg_temp.pid('P1')) = code, 'invite is reused';
 ASSERT quest.clan_join(pg_temp.pid('P3'), NULL, lower(code)) = 'OK', 'join by invite (case-insensitive)';
 ASSERT (SELECT uses FROM quest.clan_invites WHERE quest.clan_invites.code = quest.clan_invite(pg_temp.pid('P1'))) = 1, 'invite use counted';
 ASSERT quest.clan_overview(pg_temp.pid('P1'))->'clan'->>'invite' = code, 'leader sees the invite';
 ASSERT quest.clan_overview(pg_temp.pid('P2'))->'clan'->>'invite' IS NULL, 'member does not';

 -- 5. score counts only XP earned WHILE a member, inside the season
 -- P2 joined "now", so its older XP counts for nothing; backdate the membership and 1-day-old XP counts.
 ev := pg_temp.award('P2', 400, 'p2-before', 'test-quest', interval '3 days');
 UPDATE quest.clan_members SET joined_at = now() - interval '2 days' WHERE passport_id = pg_temp.pid('P2');
 -- the season starts when the migration ran; move it back for the test (the row is normally immutable)
 ALTER TABLE quest.clan_seasons DISABLE TRIGGER clan_seasons_immutable;
 UPDATE quest.clan_seasons SET starts_at = now() - interval '30 days', ends_at = now() + interval '30 days' WHERE season_key = 'season-1';
 ALTER TABLE quest.clan_seasons ENABLE TRIGGER clan_seasons_immutable;
 ev := pg_temp.award('P2', 70, 'p2-after', 'test-quest', interval '1 day');
 o := quest.clan_overview(pg_temp.pid('P1'));
 ASSERT (o->'clan'->>'seasonXp')::bigint = 70, 'only XP earned while a member counts (got ' || (o->'clan'->>'seasonXp') || ')';
 ASSERT (o->'clan'->>'score')::bigint = 70 AND (o->'clan'->>'activeMembers')::int = 1, 'score and active members';
 ASSERT (o->'clan'->>'weekXp')::bigint = 70, 'week XP';
 ASSERT jsonb_array_length(o->'clan'->'membersList') = 3, 'members listed';

 -- 6. no Passport id is ever returned
 leaked := false;
 FOR i IN 1..8 LOOP
  IF position(pg_temp.pid('P' || i)::text IN quest.clan_overview(pg_temp.pid('P1'))::text) > 0
     OR position(pg_temp.pid('P' || i)::text IN quest.clan_board(pg_temp.pid('P1'), '', 10, 0)::text) > 0 THEN leaked := true; END IF;
 END LOOP;
 ASSERT NOT leaked, 'responses never contain a Passport id';

 -- 7. leaving, cooldown, leader hand-over, kick, disband
 ASSERT quest.clan_leave(pg_temp.pid('P3')) = 'OK', 'member leaves';
 ASSERT quest.clan_leave(pg_temp.pid('P3')) = 'NOT_IN_CLAN', 'not in a clan';
 ASSERT quest.clan_create(pg_temp.pid('P3'), 'Rejoiners', 'RJN') = 'COOLDOWN', 'cooldown after leaving';
 ASSERT quest.clan_join(pg_temp.pid('P3'), cid, NULL) = 'COOLDOWN', 'cooldown also blocks joining';
 ASSERT quest.clan_kick(pg_temp.pid('P2'), gen_random_uuid()) = 'FORBIDDEN', 'members cannot kick';
 ref := (quest.clan_overview(pg_temp.pid('P2'))->'clan'->>'myRef')::uuid;
 ASSERT quest.clan_kick(pg_temp.pid('P1'), (quest.clan_overview(pg_temp.pid('P1'))->'clan'->>'myRef')::uuid) = 'FORBIDDEN', 'leader cannot kick self';
 ASSERT quest.clan_kick(pg_temp.pid('P1'), gen_random_uuid()) = 'NOT_FOUND', 'unknown member';
 -- P4 joins, is kicked and cannot be kicked twice
 ASSERT quest.clan_join(pg_temp.pid('P4'), cid, NULL) = 'OK', 'P4 joins';
 ref := (quest.clan_overview(pg_temp.pid('P4'))->'clan'->>'myRef')::uuid;
 ASSERT quest.clan_kick(pg_temp.pid('P1'), ref) = 'OK', 'leader kicks';
 ASSERT quest.clan_kick(pg_temp.pid('P1'), ref) = 'NOT_FOUND', 'already removed';
 ASSERT (quest.clan_overview(pg_temp.pid('P4'))->'clan') IS NULL OR jsonb_typeof(quest.clan_overview(pg_temp.pid('P4'))->'clan') = 'null', 'kicked member has no clan';
 -- leader leaves: P2 (joined earlier than anyone else still here) inherits
 ASSERT quest.clan_leave(pg_temp.pid('P1')) = 'OK', 'leader leaves';
 ASSERT quest.clan_overview(pg_temp.pid('P2'))->'clan'->>'role' = 'LEADER', 'longest-serving member leads';
 -- last member leaves: the clan disbands, its name and tag become free
 ASSERT quest.clan_leave(pg_temp.pid('P2')) = 'OK', 'last member leaves';
 ASSERT (quest.clan_board(pg_temp.pid('P5'), '', 10, 0)->>'total')::int = 0, 'disbanded clan is off the board';
 ASSERT quest.clan_create(pg_temp.pid('P5'), 'Moon Cats', 'MCAT') = 'OK', 'name and tag are free again';

 -- 8. capacity
 cid := (quest.clan_overview(pg_temp.pid('P5'))->'clan'->>'id')::uuid;
 FOR i IN 11..59 LOOP
  PERFORM pg_temp.eligible('P' || i);
  ASSERT quest.clan_join(pg_temp.pid('P' || i), cid, NULL) = 'OK', 'fill slot ' || i;
 END LOOP;
 ASSERT (quest.clan_overview(pg_temp.pid('P5'))->'clan'->>'members')::int = 50, 'full at 50';
 PERFORM pg_temp.eligible('P60');
 ASSERT quest.clan_join(pg_temp.pid('P60'), cid, NULL) = 'FULL', 'no 51st member';

 -- 9. the tables and helpers are closed to the serving roles
 FOREACH res IN ARRAY ARRAY['quest.clan_standings()', 'quest.clan_member_rows(uuid)', 'quest.clan_eligible(uuid)',
  'quest.clan_alias(uuid)', 'quest.clan_fresh_code()'] LOOP
  ASSERT NOT has_function_privilege('public', res, 'EXECUTE'), 'helper not public: ' || res;
 END LOOP;
 FOREACH res IN ARRAY ARRAY['quest.clan_overview(uuid)', 'quest.clan_board(uuid,text,integer,integer)', 'quest.clan_create(uuid,text,text)',
  'quest.clan_join(uuid,uuid,text)', 'quest.clan_leave(uuid)', 'quest.clan_invite(uuid)', 'quest.clan_kick(uuid,uuid)'] LOOP
  ASSERT NOT has_function_privilege('public', res, 'EXECUTE'), 'not public by default: ' || res;
 END LOOP;
 FOREACH res IN ARRAY ARRAY['quest.clans', 'quest.clan_members', 'quest.clan_invites', 'quest.clan_audit', 'quest.clan_rules', 'quest.clan_seasons'] LOOP
  ASSERT NOT has_table_privilege('public', res, 'SELECT'), 'table closed: ' || res;
 END LOOP;

 -- 10. rules, seasons and audit rows are append-only
 BEGIN UPDATE quest.clan_rules SET max_members = 99; ASSERT false, 'rules immutable';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN DELETE FROM quest.clan_audit; ASSERT false, 'audit immutable';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 SELECT count(*) INTO n FROM quest.clan_audit;
 ASSERT n > 10, 'actions are audited';
 RAISE NOTICE 'clans: all checks passed';
END;
$$;

ROLLBACK;
