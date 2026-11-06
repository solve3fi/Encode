-- Devnet TEST XP for the two onboarding quests. Not launch rewards: the environment is pinned to
-- Devnet, the values below are the approved test-only fixtures (100 and 250) and no live rate,
-- cap or eligibility rule is implied. Append-only upgrade of 001..016.
--
-- Evidence already verified by the backend is the only trigger:
--   connect-wallet  a wallet-ownership signature was verified (the sign-in challenge is consumed
--                   only after the Ed25519 check), once per Passport and once per wallet.
--   mint-pass       the finalized, successful Devnet Pass mint was verified on-chain (the
--                   reservation's verified_at is set only after that check), once per Passport and
--                   once per mint.
-- The browser, the serving role and the gateway never write XP: only these SECURITY DEFINER
-- functions do, through the append-only xp_events ledger and its unique keys.
BEGIN;

CREATE TABLE quest.devnet_onboarding_rules (
 quest_key text PRIMARY KEY CHECK(quest_key IN ('connect-wallet','mint-pass')),
 xp bigint NOT NULL CHECK(xp > 0),
 rule_revision integer NOT NULL CHECK(rule_revision > 0),
 season_key text NOT NULL CHECK(season_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 title text NOT NULL,
 description text NOT NULL
);
REVOKE ALL ON quest.devnet_onboarding_rules FROM PUBLIC;
INSERT INTO quest.devnet_onboarding_rules(quest_key,xp,rule_revision,season_key,title,description) VALUES
 ('connect-wallet',100,1,'devnet-test-2026','Connect your wallet','Sign in once with your wallet to prove you own it. Counts once per Passport.'),
 ('mint-pass',250,1,'devnet-test-2026','Mint your Devnet Pass','Mint your free Devnet Pass. Counts once per Passport, after the mint is confirmed on-chain.');
CREATE FUNCTION quest.guard_devnet_onboarding_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'Onboarding rules are append-only; add a new rule revision through a reviewed migration';
END;
$$;
CREATE TRIGGER devnet_onboarding_rules_immutable BEFORE UPDATE OR DELETE ON quest.devnet_onboarding_rules
 FOR EACH ROW EXECUTE FUNCTION quest.guard_devnet_onboarding_rules();
CREATE TRIGGER devnet_onboarding_rules_no_truncate BEFORE TRUNCATE ON quest.devnet_onboarding_rules
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_devnet_onboarding_rules();

CREATE FUNCTION quest.award_devnet_onboarding_xp(p_passport uuid,p_quest text,p_source text,p_evidence text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE r quest.devnet_onboarding_rules%ROWTYPE; n integer;
BEGIN
 SELECT * INTO r FROM quest.devnet_onboarding_rules WHERE quest_key=p_quest;
 IF r.quest_key IS NULL THEN RAISE EXCEPTION 'Unknown onboarding quest'; END IF;
 -- Calendar operator identities are not players.
 IF EXISTS(SELECT 1 FROM quest.calendar_operator_grants g WHERE g.network='DEVNET' AND g.passport_id=p_passport) THEN RETURN false; END IF;
 INSERT INTO quest.xp_events(network,passport_id,idempotency_key,kind,source_event_key,qualification_key,rule_revision,season_key,evidence_sha256,xp_delta)
 VALUES('DEVNET',p_passport,'devnet-onboarding:'||p_quest||':'||p_passport,'AWARD',p_source,p_quest,r.rule_revision,r.season_key,p_evidence,r.xp)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n=1;
END;
$$;
REVOKE ALL ON FUNCTION quest.award_devnet_onboarding_xp(uuid,text,text,text) FROM PUBLIC;

CREATE FUNCTION quest.award_onboarding_on_wallet_signature() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL AND NEW.action='passport.authenticate' THEN
  PERFORM quest.award_devnet_onboarding_xp(NEW.passport_id,'connect-wallet','wallet:'||NEW.wallet,
   encode(sha256(convert_to('connect-wallet|'||NEW.wallet||'|'||NEW.nonce_hash,'UTF8')),'hex'));
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_signature_onboarding_xp AFTER UPDATE OF consumed_at ON quest.wallet_challenges
 FOR EACH ROW EXECUTE FUNCTION quest.award_onboarding_on_wallet_signature();

CREATE FUNCTION quest.award_onboarding_on_pass_mint() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 IF OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL THEN
  PERFORM quest.award_devnet_onboarding_xp(NEW.passport_id,'mint-pass','pass-mint:'||NEW.mint,
   encode(sha256(convert_to('mint-pass|'||NEW.wallet||'|'||NEW.mint,'UTF8')),'hex'));
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER pass_mint_verified_onboarding_xp AFTER UPDATE OF verified_at ON quest.pass_mint_reservations
 FOR EACH ROW EXECUTE FUNCTION quest.award_onboarding_on_pass_mint();

-- Passports that already proved a wallet or already have a verified mint are credited once.
SELECT quest.award_devnet_onboarding_xp(c.passport_id,'connect-wallet','wallet:'||c.wallet,
 encode(sha256(convert_to('connect-wallet|'||c.wallet||'|'||c.nonce_hash,'UTF8')),'hex'))
FROM (SELECT DISTINCT ON (passport_id) * FROM quest.wallet_challenges
 WHERE consumed_at IS NOT NULL AND action='passport.authenticate' ORDER BY passport_id,consumed_at) c;
SELECT quest.award_devnet_onboarding_xp(m.passport_id,'mint-pass','pass-mint:'||m.mint,
 encode(sha256(convert_to('mint-pass|'||m.wallet||'|'||m.mint,'UTF8')),'hex'))
FROM quest.pass_mint_reservations m WHERE m.verified_at IS NOT NULL;

COMMIT;
