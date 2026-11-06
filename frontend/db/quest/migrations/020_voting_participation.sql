-- Devnet TEST Voting XP. A Passport earns 500 XP (shown on the Pass as Voting XP) and one governance
-- Level for every ENDED veSOLV3 epoch in which a lock owned by one of its linked wallets cast a vote.
-- The Level is the approved one-per-Passport-per-epoch invariant of quest.level_events (migration 002);
-- the XP goes to the append-only quest.xp_events ledger under the qualification 'governance-epoch', so
-- it is kept apart from Quest XP. Seth's test values (2026-10-06): 500 XP per voted epoch, any positive
-- voting power counts, awarded at epoch end, and an Auto-Vote cast by the keeper counts. Test values
-- only: no live rate, threshold or eligibility rule is implied. Append-only upgrade of 001..019.
--
-- Evidence: the worker reads the ve program's UserVote accounts (finalized) and records one row per
-- (epoch, vote account; one vote account per lock per epoch). UserVote.user is the lock OWNER even when
-- the public Auto-Vote keeper cast the vote, so credit follows the owner. The FIRST observation of a
-- vote is kept; re-votes and later changes never alter it. Nothing browser-facing or worker-facing can
-- write XP or a Level: only the SECURITY DEFINER function below, which the settler may execute.
BEGIN;

CREATE FUNCTION quest.guard_voting_rows() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'Voting evidence is append-only; correct it with a reviewed ledger reversal';
END;
$$;

-- Test rule: which observed votes count and what an epoch pays. No minimum power has been set, so any
-- positive power qualifies. A revision of this row is a reviewed migration, never an in-place edit.
CREATE TABLE quest.governance_test_rules (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 minimum_voting_power numeric(20,0) NOT NULL CHECK (minimum_voting_power >= 1),
 xp_per_epoch integer NOT NULL CHECK (xp_per_epoch > 0),
 rule_revision integer NOT NULL CHECK (rule_revision > 0)
);
REVOKE ALL ON quest.governance_test_rules FROM PUBLIC;
INSERT INTO quest.governance_test_rules (minimum_voting_power, xp_per_epoch, rule_revision) VALUES (1, 500, 1);
CREATE TRIGGER governance_test_rules_immutable BEFORE UPDATE OR DELETE ON quest.governance_test_rules
 FOR EACH ROW EXECUTE FUNCTION quest.guard_voting_rows();
CREATE TRIGGER governance_test_rules_no_truncate BEFORE TRUNCATE ON quest.governance_test_rules
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_voting_rows();

CREATE TABLE quest.vote_observations (
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 epoch_id bigint NOT NULL CHECK (epoch_id >= 0),
 vote_account text NOT NULL CHECK (length(vote_account) BETWEEN 32 AND 44 AND vote_account ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 owner_wallet text NOT NULL CHECK (length(owner_wallet) BETWEEN 32 AND 44 AND owner_wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 voting_power numeric(20,0) NOT NULL CHECK (voting_power > 0),
 gauge_count integer NOT NULL CHECK (gauge_count BETWEEN 1 AND 50),
 vote_time timestamptz NOT NULL,
 observed_slot bigint NOT NULL CHECK (observed_slot >= 0),
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (network, epoch_id, vote_account)
);
CREATE INDEX vote_observations_by_owner ON quest.vote_observations (network, owner_wallet, epoch_id);
REVOKE ALL ON quest.vote_observations FROM PUBLIC;
CREATE TRIGGER vote_observations_immutable BEFORE UPDATE OR DELETE ON quest.vote_observations
 FOR EACH ROW EXECUTE FUNCTION quest.guard_voting_rows();
CREATE TRIGGER vote_observations_no_truncate BEFORE TRUNCATE ON quest.vote_observations
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_voting_rows();

-- The protocol epoch the worker saw at each round (finalized). An epoch is settled only once a LATER
-- epoch has been seen, so every vote of the settled epoch had already been observed.
CREATE TABLE quest.vote_epoch_heads (
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 epoch_id bigint NOT NULL CHECK (epoch_id >= 0),
 epoch_start_time timestamptz NOT NULL,
 observed_slot bigint NOT NULL CHECK (observed_slot >= 0),
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (network, epoch_id)
);
REVOKE ALL ON quest.vote_epoch_heads FROM PUBLIC;
CREATE TRIGGER vote_epoch_heads_immutable BEFORE UPDATE OR DELETE ON quest.vote_epoch_heads
 FOR EACH ROW EXECUTE FUNCTION quest.guard_voting_rows();
CREATE TRIGGER vote_epoch_heads_no_truncate BEFORE TRUNCATE ON quest.vote_epoch_heads
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_voting_rows();

-- Award, per Passport per ENDED epoch: one governance Level (+1) and the epoch's XP. All wallets linked
-- to the Passport at the vote time and all of their locks are aggregated into one award, so a second
-- lock, a second gauge, a re-vote or an Auto-Vote cannot add more. The unique keys of level_events and
-- xp_events make a retry, a replay or a second settler a no-op. A wallet only counts for votes cast
-- while it was linked. Returns how many Passport-epochs were awarded and the newest epoch seen.
CREATE FUNCTION quest.settle_voting_epochs() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE head bigint; rule quest.governance_test_rules%ROWTYPE; added integer;
BEGIN
 SELECT max(epoch_id) INTO head FROM quest.vote_epoch_heads WHERE network = 'DEVNET';
 IF head IS NULL THEN
  RETURN jsonb_build_object('settled', 0, 'currentEpoch', NULL);
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
REVOKE ALL ON FUNCTION quest.settle_voting_epochs() FROM PUBLIC;

-- What the Pass shows for one Passport: Voting XP so far (reversals subtract), the epochs voted, whether
-- this epoch already has a vote (earned when it ends), and the recent epochs that paid.
CREATE FUNCTION quest.voting_overview(p_passport uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE head bigint; total integer; per_epoch integer; voted_now boolean := false; recent jsonb;
BEGIN
 SELECT max(epoch_id) INTO head FROM quest.vote_epoch_heads WHERE network = 'DEVNET';
 SELECT xp_per_epoch INTO per_epoch FROM quest.governance_test_rules WHERE singleton;
 SELECT COALESCE(sum(e.xp_delta), 0)::integer INTO total
 FROM quest.xp_events e
 LEFT JOIN quest.xp_events original ON original.event_id = e.reverses_event_id
 WHERE e.network = 'DEVNET' AND e.passport_id = p_passport
  AND COALESCE(e.qualification_key, original.qualification_key) = 'governance-epoch';
 IF head IS NOT NULL THEN
  SELECT EXISTS (
   SELECT 1 FROM quest.vote_observations o
   JOIN quest.wallet_links l
    ON l.network = o.network AND l.wallet = o.owner_wallet AND l.passport_id = p_passport
    AND l.linked_at <= o.vote_time AND (l.unlinked_at IS NULL OR l.unlinked_at > o.vote_time)
   WHERE o.network = 'DEVNET' AND o.epoch_id = head
    AND o.voting_power >= (SELECT minimum_voting_power FROM quest.governance_test_rules WHERE singleton)
  ) INTO voted_now;
 END IF;
 -- Epochs that paid and were not reversed. The epoch is the second field of 'governance:<epoch>:<passport>'.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('epoch', r.epoch_id, 'earned', true) ORDER BY r.epoch_id DESC), '[]'::jsonb)
 INTO recent
 FROM (
  SELECT split_part(a.source_event_key, ':', 2)::bigint AS epoch_id
  FROM quest.xp_events a
  WHERE a.network = 'DEVNET' AND a.passport_id = p_passport AND a.kind = 'AWARD'
   AND a.qualification_key = 'governance-epoch'
   AND NOT EXISTS (SELECT 1 FROM quest.xp_events x WHERE x.reverses_event_id = a.event_id)
  ORDER BY 1 DESC LIMIT 8
 ) r;
 RETURN jsonb_build_object(
  'testOnly', true,
  'votingXp', total,
  'xpPerEpoch', per_epoch,
  'currentEpoch', head,
  'votedThisEpoch', voted_now,
  'recentEpochs', recent
 );
END;
$$;
REVOKE ALL ON FUNCTION quest.voting_overview(uuid) FROM PUBLIC;

COMMIT;
