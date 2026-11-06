-- Dedicated Devnet-only reservations; no XP, runtime grants or funded payer.
BEGIN;
CREATE TABLE quest.pass_mint_reservations (
 network text NOT NULL DEFAULT 'DEVNET' CHECK(network='DEVNET'),
 wallet text NOT NULL,
 passport_id uuid NOT NULL,
 mint text NOT NULL CHECK(length(mint) BETWEEN 32 AND 44 AND mint ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 verified_at timestamptz,
 prepared jsonb CHECK(prepared IS NULL OR (jsonb_typeof(prepared)='object' AND prepared ?& ARRAY['wallet','mint','network','status','lastValidBlockHeight','transaction','blockhash','maxCostLamports'] AND length(prepared::text)<8192 AND prepared->>'wallet'=wallet AND prepared->>'mint'=mint AND prepared->>'network'='DEVNET' AND prepared->>'status'='PREPARED' AND prepared->>'lastValidBlockHeight' ~ '^[0-9]+$')),
 PRIMARY KEY(network,wallet), UNIQUE(network,passport_id), UNIQUE(network,mint),
 FOREIGN KEY(network,wallet,passport_id) REFERENCES quest.wallet_bindings(network,wallet,passport_id),
 CHECK(verified_at IS NULL OR verified_at >= created_at)
);
CREATE FUNCTION quest.guard_pass_mint_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Pass mint reservations cannot be removed'; END IF;
 IF NEW.network IS DISTINCT FROM OLD.network OR NEW.wallet IS DISTINCT FROM OLD.wallet OR
 NEW.passport_id IS DISTINCT FROM OLD.passport_id OR NEW.mint IS DISTINCT FROM OLD.mint OR
 NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.verified_at IS NOT NULL OR
 NEW.verified_at > clock_timestamp() THEN RAISE EXCEPTION 'Pass mint reservation is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER pass_mint_reservation_guard BEFORE UPDATE OR DELETE ON quest.pass_mint_reservations
 FOR EACH ROW EXECUTE FUNCTION quest.guard_pass_mint_reservation();
CREATE TRIGGER pass_mint_reservation_truncate BEFORE TRUNCATE ON quest.pass_mint_reservations
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_pass_mint_reservation();
REVOKE ALL ON quest.pass_mint_reservations FROM PUBLIC;
CREATE INDEX pass_mint_created_at ON quest.pass_mint_reservations(created_at);
CREATE FUNCTION quest.limit_new_pass_reservations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(193676132);
 IF EXISTS(SELECT 1 FROM quest.pass_mint_reservations WHERE network=NEW.network AND wallet=NEW.wallet) THEN RETURN NEW; END IF;
 IF (SELECT count(*) FROM quest.pass_mint_reservations WHERE created_at > clock_timestamp()-interval '1 hour') >= 600 THEN RAISE EXCEPTION 'Pass reservation capacity reached'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER pass_mint_reservation_limit BEFORE INSERT ON quest.pass_mint_reservations
 FOR EACH ROW EXECUTE FUNCTION quest.limit_new_pass_reservations();
COMMIT;
