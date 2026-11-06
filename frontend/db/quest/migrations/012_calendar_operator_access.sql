-- Dormant scoped operator access and immutable request receipts. No operator
-- grant/policy rows, login roles, public endpoints or XP writer are provisioned.
BEGIN;
CREATE TABLE quest.calendar_operator_grants (
 grant_id uuid PRIMARY KEY,
 network text NOT NULL DEFAULT 'DEVNET' CHECK(network='DEVNET'),
 passport_id uuid NOT NULL,
 link_id bigint NOT NULL REFERENCES quest.wallet_links(link_id),
 campaign_id text NOT NULL CHECK(campaign_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
 capability text NOT NULL CHECK(capability IN ('publish','revise','observe')),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 FOREIGN KEY(network,passport_id) REFERENCES quest.passports(network,passport_id),
 CHECK(issued_at=date_trunc('milliseconds',issued_at)),
 CHECK(expires_at=date_trunc('milliseconds',expires_at)),
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '366 days'),
 CHECK(revoked_at IS NULL OR revoked_at>=issued_at)
);
CREATE UNIQUE INDEX calendar_operator_active_scope ON quest.calendar_operator_grants(link_id,campaign_id,capability) WHERE revoked_at IS NULL;
CREATE FUNCTION quest.guard_calendar_operator_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Operator grant history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.grant_id,NEW.network,NEW.passport_id,NEW.link_id,NEW.campaign_id,NEW.capability,NEW.issued_at,NEW.expires_at)
   IS DISTINCT FROM ROW(OLD.grant_id,OLD.network,OLD.passport_id,OLD.link_id,OLD.campaign_id,OLD.capability,OLD.issued_at,OLD.expires_at)
   OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_at>clock_timestamp() THEN
   RAISE EXCEPTION 'Operator grant can only be revoked once';
  END IF;
 ELSE
  IF NEW.issued_at>clock_timestamp() OR NEW.revoked_at IS NOT NULL OR NOT EXISTS
   (SELECT 1 FROM quest.wallet_links l WHERE l.link_id=NEW.link_id AND l.network=NEW.network AND l.passport_id=NEW.passport_id AND l.unlinked_at IS NULL AND l.linked_at<=NEW.issued_at) THEN
   RAISE EXCEPTION 'Operator grant requires the current exact wallet link';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER calendar_operator_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON quest.calendar_operator_grants FOR EACH ROW EXECUTE FUNCTION quest.guard_calendar_operator_grant();

-- A narrow shared lock makes revocation wait without giving the serving role
-- permission to update operator grants. Recheck clocks after any lock wait.
CREATE FUNCTION quest.lock_calendar_operator_grant(p_session uuid,p_campaign text,p_capability text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
DECLARE found_id uuid; found_expiry timestamptz; session_expiry timestamptz; now_at timestamptz;
BEGIN
 SELECT g.grant_id,g.expires_at,s.expires_at INTO found_id,found_expiry,session_expiry
 FROM quest.passport_sessions s JOIN quest.passport_auth_bindings b ON b.session_id=s.session_id
 JOIN quest.wallet_links l ON l.link_id=b.link_id AND l.network=s.network AND l.passport_id=s.passport_id
 JOIN quest.calendar_operator_grants g ON g.network=s.network AND g.passport_id=s.passport_id AND g.link_id=l.link_id
 WHERE s.session_id=p_session AND s.network='DEVNET' AND s.revoked_at IS NULL
 AND s.issued_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
 AND l.unlinked_at IS NULL AND l.linked_at<=s.issued_at
 AND g.campaign_id=p_campaign AND g.capability=p_capability
 AND g.revoked_at IS NULL AND g.issued_at<=clock_timestamp() AND g.expires_at>clock_timestamp()
 FOR SHARE OF g,s,l;
 now_at=clock_timestamp();
 IF found_id IS NULL OR found_expiry<=now_at OR session_expiry<=now_at THEN RETURN NULL; END IF;
 RETURN found_id;
END;
$$;

CREATE TABLE quest.calendar_operator_requests (
 request_id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES quest.passport_sessions(session_id),
 grant_id uuid NOT NULL REFERENCES quest.calendar_operator_grants(grant_id),
 actor_passport_id uuid NOT NULL,
 network text NOT NULL DEFAULT 'DEVNET' CHECK(network='DEVNET'),
 campaign_id text NOT NULL REFERENCES quest.calendar_plans(campaign_id),
 operation text NOT NULL CHECK(operation IN ('publish','revise','observe')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 response jsonb NOT NULL CHECK((jsonb_typeof(response)='object'
  AND response->>'awardEligible'='false'
  AND response->>'replayed'='false'
  AND octet_length(response::text)<=8192) IS TRUE),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(network,actor_passport_id) REFERENCES quest.passports(network,passport_id)
);
CREATE FUNCTION quest.guard_calendar_operator_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_grant uuid;
BEGIN
 selected_grant=quest.lock_calendar_operator_grant(NEW.session_id,NEW.campaign_id,NEW.operation);
 IF selected_grant IS NULL OR selected_grant<>NEW.grant_id OR NOT EXISTS
  (SELECT 1 FROM quest.passport_sessions s WHERE s.session_id=NEW.session_id AND s.passport_id=NEW.actor_passport_id AND s.network=NEW.network) THEN
  RAISE EXCEPTION 'Current operator session and grant required';
 END IF;
 NEW.recorded_at=clock_timestamp();
 RETURN NEW;
END;
$$;
CREATE TRIGGER calendar_operator_request_guard BEFORE INSERT ON quest.calendar_operator_requests FOR EACH ROW EXECUTE FUNCTION quest.guard_calendar_operator_request();
CREATE TRIGGER calendar_operator_request_immutable BEFORE UPDATE OR DELETE ON quest.calendar_operator_requests FOR EACH ROW EXECUTE FUNCTION quest.reject_calendar_change();
REVOKE ALL ON quest.calendar_operator_grants,quest.calendar_operator_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION quest.guard_calendar_operator_grant(),quest.lock_calendar_operator_grant(uuid,text,text),quest.guard_calendar_operator_request() FROM PUBLIC;
COMMIT;
