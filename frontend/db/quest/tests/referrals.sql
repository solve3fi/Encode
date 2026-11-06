-- Referral behaviour test. Run as the schema owner in a DISPOSABLE database after migrations 001..019,
-- with login roles quest_runtime and quest_operator granted EXECUTE as in apply-schema.mjs.
-- Everything runs in one transaction that is rolled back.
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE t (name text PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());
INSERT INTO t (name) VALUES ('A'), ('B'), ('C');
INSERT INTO quest.passports (passport_id) SELECT id FROM t;

CREATE FUNCTION pg_temp.pid(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t WHERE name = n $$;
CREATE FUNCTION pg_temp.award(n text, xp bigint, tag text, past boolean DEFAULT false) RETURNS bigint LANGUAGE sql AS $$
 INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, source_event_key, qualification_key,
                              rule_revision, season_key, evidence_sha256, xp_delta, recorded_at)
 VALUES ('DEVNET', pg_temp.pid(n), 'test:' || tag, 'AWARD', 'test:' || tag, 'test-quest', 1, 'devnet-test-2026',
         encode(sha256(convert_to(tag, 'UTF8')), 'hex'), xp,
         CASE WHEN past THEN now() - interval '1 day' ELSE now() END)
 RETURNING event_id $$;

DO $$
DECLARE o1 jsonb; o2 jsonb; res text; ev bigint; bonus bigint; i integer; rid uuid; p uuid;
BEGIN
 -- 1. a code is created once, is well formed and is stable
 o1 := quest.referral_overview(pg_temp.pid('A'));
 o2 := quest.referral_overview(pg_temp.pid('A'));
 ASSERT o1->>'code' ~ '^[A-HJ-NP-Z2-9]{8}$', 'code format';
 ASSERT o1->>'code' = o2->>'code', 'code is stable';
 ASSERT (o1->>'ratePercent')::int = 10 AND (o1->>'maxReferrals')::int = 25, 'rules exposed';
 ASSERT (o1->>'referredCount')::int = 0 AND (o1->>'bonusXp')::bigint = 0 AND (o1->>'referredBy')::boolean = false, 'fresh totals';

 -- 2. redemption rules
 ASSERT quest.redeem_referral(pg_temp.pid('B'), 'short') = 'INVALID', 'malformed';
 ASSERT quest.redeem_referral(pg_temp.pid('B'), 'AAAAAAAA') = 'INVALID', 'unknown code';
 ASSERT quest.redeem_referral(pg_temp.pid('A'), o1->>'code') = 'SELF', 'own code';
 -- XP the referred Passport earned BEFORE redeeming earns nothing
 ev := pg_temp.award('B', 400, 'b-before', true);
 ASSERT quest.redeem_referral(pg_temp.pid('B'), lower(o1->>'code')) = 'OK', 'redeem (case-insensitive)';
 ASSERT quest.redeem_referral(pg_temp.pid('B'), o1->>'code') = 'ALREADY', 'only once';
 ASSERT quest.redeem_referral(pg_temp.pid('C'), o1->>'code') = 'OK', 'second friend';
 PERFORM quest.referral_overview(pg_temp.pid('B'));
 ASSERT quest.redeem_referral(pg_temp.pid('A'), (quest.referral_overview(pg_temp.pid('B')))->>'code') = 'CYCLE', 'no two-way referral';
 ASSERT (SELECT count(*) FROM quest.xp_events WHERE qualification_key = 'referral-bonus') = 0, 'no bonus for earlier XP';

 -- 3. 10% of XP earned after redeeming, floored, never recursive
 ev := pg_temp.award('B', 250, 'b-mint');
 SELECT xp_delta INTO bonus FROM quest.xp_events
  WHERE passport_id = pg_temp.pid('A') AND qualification_key = 'referral-bonus' AND source_event_key = 'referral:' || ev;
 ASSERT bonus = 25, 'bonus is 10% of 250';
 PERFORM pg_temp.award('B', 5, 'b-tiny');
 ASSERT (SELECT count(*) FROM quest.xp_events WHERE passport_id = pg_temp.pid('A') AND qualification_key = 'referral-bonus') = 1,
  'a bonus that rounds to zero is skipped';
 ASSERT (SELECT count(*) FROM quest.xp_events WHERE passport_id = pg_temp.pid('B') AND qualification_key = 'referral-bonus') = 0,
  'bonuses are not referred again';
 ASSERT (quest.referral_overview(pg_temp.pid('A'))->>'bonusXp')::bigint = 25, 'totals show the bonus';
 ASSERT (quest.referral_overview(pg_temp.pid('A'))->>'referredCount')::int = 2, 'two friends';
 ASSERT (quest.referral_overview(pg_temp.pid('B'))->>'referredBy')::boolean, 'referredBy flag';

 -- 4. a reversal of the referred Passport's XP reverses the bonus once
 INSERT INTO quest.xp_events (network, passport_id, idempotency_key, kind, reverses_event_id, review_ref, season_key, xp_delta)
 VALUES ('DEVNET', pg_temp.pid('B'), 'test:rev', 'REVERSAL', ev, 'test-review', 'devnet-test-2026', -250);
 ASSERT (SELECT COALESCE(sum(xp_delta), 0) FROM quest.xp_events WHERE passport_id = pg_temp.pid('A')) = 0,
  'bonus reversed';
 ASSERT (SELECT count(*) FROM quest.xp_events WHERE passport_id = pg_temp.pid('A') AND kind = 'REVERSAL') = 1, 'one reversal';

 -- 5. a code has a limit
 FOR i IN 1..25 LOOP
  rid := gen_random_uuid();
  INSERT INTO quest.passports (passport_id) VALUES (rid);
  res := quest.redeem_referral(rid, o1->>'code');
  EXIT WHEN res <> 'OK';
 END LOOP;
 rid := gen_random_uuid();
 INSERT INTO quest.passports (passport_id) VALUES (rid);
 ASSERT quest.redeem_referral(rid, o1->>'code') = 'FULL', 'code is full after 25';

 -- 6. rows are append-only
 BEGIN
  UPDATE quest.referrals SET code = 'ZZZZZZZZ';
  RAISE EXCEPTION 'update should have failed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'update should have failed' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM quest.referral_codes;
  RAISE EXCEPTION 'delete should have failed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM = 'delete should have failed' THEN RAISE; END IF;
 END;

 -- 7. the serving roles can call the functions but cannot read or write the tables
 p := pg_temp.pid('A');
 SET LOCAL ROLE quest_runtime;
 PERFORM quest.referral_overview(p);
 BEGIN
  PERFORM 1 FROM quest.referrals LIMIT 1;
  RAISE EXCEPTION 'select should have failed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO quest.referrals (referred_passport_id, referrer_passport_id, code) VALUES (gen_random_uuid(), gen_random_uuid(), 'AAAAAAAA');
  RAISE EXCEPTION 'insert should have failed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 RESET ROLE;

 RAISE WARNING 'referral tests passed';
END;
$$;
ROLLBACK;
