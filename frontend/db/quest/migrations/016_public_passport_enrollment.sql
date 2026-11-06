-- Public Devnet bootstrap capability, separate from the serving login. No grants.
BEGIN;
ALTER TABLE quest.passport_rate_policies DROP CONSTRAINT passport_rate_policies_scope_check;
ALTER TABLE quest.passport_rate_policies ADD CHECK(scope IN ('challenge','authenticate','session','enroll'));
INSERT INTO quest.passport_rate_policies(scope,request_limit,window_ms) VALUES('enroll',600,3600000);
CREATE TABLE quest.passport_enrollment_proofs (
 nonce_hash text PRIMARY KEY CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),
 wallet text NOT NULL CHECK(length(wallet) BETWEEN 32 AND 44 AND wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 passport_id uuid NOT NULL,
 domain text NOT NULL CHECK(length(domain) BETWEEN 1 AND 255),
 issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 CHECK(expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'),
 CHECK(consumed_at IS NULL OR (consumed_at >= issued_at AND consumed_at < expires_at))
);
REVOKE ALL ON quest.passport_enrollment_proofs FROM PUBLIC;
CREATE INDEX passport_enrollment_issued_at ON quest.passport_enrollment_proofs(issued_at);
CREATE FUNCTION quest.guard_enrollment_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Enrollment proofs cannot be removed'; END IF;
 IF NEW.nonce_hash IS DISTINCT FROM OLD.nonce_hash OR NEW.wallet IS DISTINCT FROM OLD.wallet OR
 NEW.passport_id IS DISTINCT FROM OLD.passport_id OR NEW.domain IS DISTINCT FROM OLD.domain OR
 NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
 OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR NEW.consumed_at>clock_timestamp()
 THEN RAISE EXCEPTION 'Enrollment proof is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER passport_enrollment_immutable BEFORE UPDATE OR DELETE ON quest.passport_enrollment_proofs
 FOR EACH ROW EXECUTE FUNCTION quest.guard_enrollment_proof();
CREATE TRIGGER passport_enrollment_no_truncate BEFORE TRUNCATE ON quest.passport_enrollment_proofs
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_enrollment_proof();
CREATE FUNCTION quest.issue_passport_enrollment(p_nonce text,p_wallet text,p_passport uuid,p_domain text,p_environment uuid,p_manifest text)
RETURNS TABLE(issued_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE stamp timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM quest.environment_identity WHERE network='DEVNET' AND environment_id=p_environment AND manifest_sha256=p_manifest) THEN RAISE EXCEPTION 'Environment differs'; END IF;
 IF EXISTS(SELECT 1 FROM quest.wallet_bindings WHERE network='DEVNET' AND wallet=p_wallet) THEN RAISE EXCEPTION 'Wallet already bound'; END IF;
 PERFORM pg_advisory_xact_lock(193676133);
 IF (SELECT count(*) FROM quest.passport_enrollment_proofs e WHERE e.issued_at>clock_timestamp()-interval '1 hour')>=600 THEN RAISE EXCEPTION 'Enrollment capacity reached'; END IF;
 stamp=date_trunc('milliseconds',clock_timestamp());
 INSERT INTO quest.passport_enrollment_proofs VALUES(p_nonce,p_wallet,p_passport,p_domain,stamp,stamp+interval '5 minutes',NULL);
 RETURN QUERY SELECT stamp,stamp+interval '5 minutes';
END;
$$;
CREATE FUNCTION quest.complete_passport_enrollment(p_nonce text,p_wallet text,p_passport uuid,p_domain text,p_issued timestamptz,p_expires timestamptz,p_environment uuid,p_manifest text,p_evidence text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE proof quest.passport_enrollment_proofs%ROWTYPE; stamp timestamptz; link bigint; challenge uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM quest.environment_identity WHERE network='DEVNET' AND environment_id=p_environment AND manifest_sha256=p_manifest) THEN RAISE EXCEPTION 'Environment differs'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('devnet-enroll:'||p_wallet,0));
 SELECT * INTO proof FROM quest.passport_enrollment_proofs WHERE nonce_hash=p_nonce FOR UPDATE;
 stamp=date_trunc('milliseconds',clock_timestamp());
 IF proof.nonce_hash IS NULL OR proof.consumed_at IS NOT NULL OR proof.wallet<>p_wallet OR proof.passport_id<>p_passport OR proof.domain<>p_domain OR proof.issued_at<>p_issued OR proof.expires_at<>p_expires OR stamp<proof.issued_at OR stamp>=proof.expires_at THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM quest.wallet_bindings WHERE network='DEVNET' AND wallet=p_wallet) THEN RETURN false; END IF;
 UPDATE quest.passport_enrollment_proofs SET consumed_at=stamp WHERE nonce_hash=p_nonce;
 INSERT INTO quest.passports(network,passport_id) VALUES('DEVNET',p_passport);
 INSERT INTO quest.wallet_bindings(network,wallet,passport_id) VALUES('DEVNET',p_wallet,p_passport);
 INSERT INTO quest.wallet_links(network,wallet,passport_id,linked_at,link_evidence_sha256) VALUES('DEVNET',p_wallet,p_passport,stamp,p_evidence) RETURNING link_id INTO link;
 INSERT INTO quest.wallet_challenges(network,nonce_hash,action,passport_id,wallet,domain,issued_at,expires_at)
 VALUES('DEVNET',p_nonce,'passport.authenticate',p_passport,p_wallet,p_domain,p_issued,p_expires) RETURNING challenge_id INTO challenge;
 INSERT INTO quest.passport_challenge_bindings(challenge_id,link_id) VALUES(challenge,link);
 RETURN true;
END;
$$;
-- First-connect proof predates the link by the user's signature wait. Permit only
-- the exact consumed enrollment proof; never backdate the link/source attribution.
CREATE OR REPLACE FUNCTION quest.guard_passport_challenge_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE c quest.wallet_challenges%ROWTYPE; selected_id bigint;
BEGIN
 SELECT * INTO c FROM quest.wallet_challenges WHERE challenge_id=NEW.challenge_id;
 IF c.challenge_id IS NULL OR c.network<>'DEVNET' OR c.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'Unconsumed challenge required'; END IF;
 selected_id=quest.lock_passport_auth_link(c.passport_id,c.wallet);
 IF selected_id IS NULL OR selected_id<>NEW.link_id OR NOT EXISTS(
  SELECT 1 FROM quest.wallet_links l WHERE l.link_id=selected_id AND (l.linked_at<=c.issued_at OR EXISTS(
   SELECT 1 FROM quest.passport_enrollment_proofs e WHERE e.nonce_hash=c.nonce_hash AND e.wallet=c.wallet AND e.passport_id=c.passport_id AND e.domain=c.domain AND e.issued_at=c.issued_at AND e.expires_at=c.expires_at AND e.consumed_at=l.linked_at)))
 THEN RAISE EXCEPTION 'Challenge wallet link differs'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.issue_passport_enrollment(text,text,uuid,text,uuid,text),quest.complete_passport_enrollment(text,text,uuid,text,timestamptz,timestamptz,uuid,text,text) FROM PUBLIC;
COMMIT;
