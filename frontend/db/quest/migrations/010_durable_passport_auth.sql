-- Dormant Devnet authentication. No policies, runtime grants or routes created.
BEGIN;
CREATE TABLE quest.passport_challenge_bindings (
 challenge_id uuid PRIMARY KEY REFERENCES quest.wallet_challenges(challenge_id),
 link_id bigint NOT NULL REFERENCES quest.wallet_links(link_id)
);
CREATE TABLE quest.passport_auth_bindings (
 session_id uuid PRIMARY KEY REFERENCES quest.passport_sessions(session_id),
 challenge_id uuid NOT NULL UNIQUE REFERENCES quest.passport_challenge_bindings(challenge_id),
 link_id bigint NOT NULL REFERENCES quest.wallet_links(link_id),
 domain text NOT NULL CHECK(length(domain) BETWEEN 1 AND 255),
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE quest.passport_rate_policies (
 scope text PRIMARY KEY CHECK(scope IN ('challenge','authenticate','session')),
 request_limit integer NOT NULL CHECK(request_limit BETWEEN 1 AND 10000),
 window_ms integer NOT NULL CHECK(window_ms BETWEEN 1000 AND 3600000)
);
CREATE TABLE quest.passport_rate_buckets (
 scope text NOT NULL REFERENCES quest.passport_rate_policies(scope),
 subject_hash text NOT NULL CHECK(subject_hash ~ '^[a-f0-9]{64}$'),
 window_start_ms bigint NOT NULL CHECK(window_start_ms>=0),
 attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 10001),
 PRIMARY KEY(scope,subject_hash)
);
REVOKE ALL ON quest.passport_challenge_bindings,quest.passport_auth_bindings,quest.passport_rate_policies,quest.passport_rate_buckets FROM PUBLIC;

-- Only the narrow lock operation runs with owner authority. Auth roles need no
-- wallet-link UPDATE permission. An unlink must wait for this shared row lock.
CREATE FUNCTION quest.lock_passport_auth_link(p_passport uuid,p_wallet text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE selected_id bigint;
BEGIN
 SELECT link_id INTO selected_id FROM quest.wallet_links
 WHERE network='DEVNET' AND passport_id=p_passport AND wallet=p_wallet
 AND unlinked_at IS NULL AND linked_at<=clock_timestamp() FOR SHARE;
 RETURN selected_id;
END;
$$;
REVOKE ALL ON FUNCTION quest.lock_passport_auth_link(uuid,text) FROM PUBLIC;

CREATE FUNCTION quest.guard_passport_challenge_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c quest.wallet_challenges%ROWTYPE; selected_id bigint;
BEGIN
 SELECT * INTO c FROM quest.wallet_challenges WHERE challenge_id=NEW.challenge_id;
 IF c.challenge_id IS NULL OR c.network<>'DEVNET' OR c.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'Unconsumed challenge required'; END IF;
 selected_id=quest.lock_passport_auth_link(c.passport_id,c.wallet);
 IF selected_id IS NULL OR selected_id<>NEW.link_id OR NOT EXISTS(SELECT 1 FROM quest.wallet_links l WHERE l.link_id=selected_id AND l.linked_at<=c.issued_at) THEN RAISE EXCEPTION 'Challenge wallet link differs'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER passport_challenge_binding_guard BEFORE INSERT ON quest.passport_challenge_bindings FOR EACH ROW EXECUTE FUNCTION quest.guard_passport_challenge_binding();
CREATE TRIGGER passport_challenge_bindings_immutable BEFORE UPDATE OR DELETE ON quest.passport_challenge_bindings FOR EACH ROW EXECUTE FUNCTION quest.guard_wallet_binding_mutation();
CREATE TRIGGER passport_challenge_bindings_no_truncate BEFORE TRUNCATE ON quest.passport_challenge_bindings FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_wallet_binding_mutation();

CREATE FUNCTION quest.guard_passport_auth_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s quest.passport_sessions%ROWTYPE; c quest.wallet_challenges%ROWTYPE; selected_id bigint;
BEGIN
 SELECT * INTO s FROM quest.passport_sessions WHERE session_id=NEW.session_id FOR SHARE;
 SELECT * INTO c FROM quest.wallet_challenges WHERE challenge_id=NEW.challenge_id;
 IF s.session_id IS NULL OR c.challenge_id IS NULL OR s.network<>'DEVNET' OR c.network<>'DEVNET'
 OR s.passport_id<>c.passport_id OR c.consumed_at IS NULL OR c.consumed_at<>s.issued_at
 OR s.revoked_at IS NOT NULL OR NEW.domain<>c.domain
 OR NOT EXISTS(SELECT 1 FROM quest.passport_challenge_bindings b WHERE b.challenge_id=c.challenge_id AND b.link_id=NEW.link_id) THEN
  RAISE EXCEPTION 'Session/challenge binding differs'; END IF;
 selected_id=quest.lock_passport_auth_link(s.passport_id,c.wallet);
 IF selected_id IS NULL OR selected_id<>NEW.link_id THEN RAISE EXCEPTION 'Session wallet link differs'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER passport_auth_binding_guard BEFORE INSERT ON quest.passport_auth_bindings FOR EACH ROW EXECUTE FUNCTION quest.guard_passport_auth_binding();
CREATE TRIGGER passport_auth_bindings_immutable BEFORE UPDATE OR DELETE ON quest.passport_auth_bindings FOR EACH ROW EXECUTE FUNCTION quest.guard_wallet_binding_mutation();
CREATE TRIGGER passport_auth_bindings_no_truncate BEFORE TRUNCATE ON quest.passport_auth_bindings FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_wallet_binding_mutation();
CREATE TRIGGER passport_rate_policies_immutable BEFORE UPDATE OR DELETE ON quest.passport_rate_policies FOR EACH ROW EXECUTE FUNCTION quest.guard_wallet_binding_mutation();
CREATE TRIGGER passport_rate_policies_no_truncate BEFORE TRUNCATE ON quest.passport_rate_policies FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_wallet_binding_mutation();

-- The counter commits separately from auth failures. Database time is the only
-- clock; counters saturate, and backwards clock movement cannot reset a window.
CREATE FUNCTION quest.take_passport_rate_limit(p_scope text,p_subject_hash text)
RETURNS TABLE(allowed boolean,remaining integer,window_ms integer,request_limit integer,retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE policy quest.passport_rate_policies%ROWTYPE; stamp bigint; window_start bigint; counted integer; saved_start bigint;
BEGIN
 IF p_subject_hash IS NULL OR p_subject_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid rate key'; END IF;
 SELECT * INTO policy FROM quest.passport_rate_policies WHERE scope=p_scope FOR SHARE;
 IF policy.scope IS NULL THEN RAISE EXCEPTION 'Rate policy missing'; END IF;
 -- Sample time only after waiting for this bucket's existing writer. Otherwise
 -- a queued attempt can be admitted using a window that has already ended.
 PERFORM pg_advisory_xact_lock(hashtextextended('passport-rate:'||p_scope||':'||p_subject_hash,61747));
 stamp=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 window_start=stamp-(stamp%policy.window_ms);
 INSERT INTO quest.passport_rate_buckets AS b(scope,subject_hash,window_start_ms,attempts)
 VALUES(p_scope,p_subject_hash,window_start,1)
 ON CONFLICT(scope,subject_hash) DO UPDATE SET
 window_start_ms=GREATEST(b.window_start_ms,EXCLUDED.window_start_ms),
 attempts=CASE WHEN EXCLUDED.window_start_ms>b.window_start_ms THEN 1 ELSE LEAST(b.attempts+1,policy.request_limit+1) END
 RETURNING b.attempts,b.window_start_ms INTO counted,saved_start;
 -- Keep one denied attempt above the limit even when the counter saturates.
 allowed=saved_start=window_start AND counted<=policy.request_limit;
 remaining=CASE WHEN allowed THEN policy.request_limit-counted ELSE 0 END;
 window_ms=policy.window_ms;request_limit=policy.request_limit;
 retry_after_seconds=GREATEST(1,ceil((saved_start+policy.window_ms-stamp)/1000.0)::integer);
 RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION quest.take_passport_rate_limit(text,text) FROM PUBLIC;
COMMIT;
