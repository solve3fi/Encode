-- Permanent carry-over record of every wallet that minted the Devnet Solve3 Pass. At mainnet launch these
-- wallets are to be awarded XP for the Pass mint; no other Devnet XP carries over (it resets). This table
-- therefore records ONLY who minted: the wallet, the Pass mint, and when the mint was verified. It holds no
-- XP, no Passport id and no other activity. The XP amount for the mainnet award is not decided here.
-- Append-only upgrade of 001..020.
--
-- Evidence: a row is written when a Pass mint reservation is verified (finalized, successful, checked
-- on-chain by the existing verifier), by the trigger below, and existing verified mints are backfilled once.
-- A wallet can mint at most one Pass, so the wallet is the key. Rows cannot be updated, deleted or truncated.
-- Because the Quest database is reset for mainnet, the rows are also exported to the repository with
-- scripts/quest/export-devnet-pass-minters.sql; that export is the copy that survives the reset.
BEGIN;

CREATE FUNCTION quest.guard_devnet_pass_minters() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'The Devnet Pass minter record is permanent and append-only';
END;
$$;

CREATE TABLE quest.devnet_pass_minters (
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 wallet text NOT NULL CHECK (length(wallet) BETWEEN 32 AND 44 AND wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 pass_mint text NOT NULL CHECK (length(pass_mint) BETWEEN 32 AND 44 AND pass_mint ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 minted_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 source text NOT NULL CHECK (source IN ('BACKFILL', 'LIVE')),
 evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY (network, wallet),
 UNIQUE (network, pass_mint)
);
REVOKE ALL ON quest.devnet_pass_minters FROM PUBLIC;
CREATE TRIGGER devnet_pass_minters_immutable BEFORE UPDATE OR DELETE ON quest.devnet_pass_minters
 FOR EACH ROW EXECUTE FUNCTION quest.guard_devnet_pass_minters();
CREATE TRIGGER devnet_pass_minters_no_truncate BEFORE TRUNCATE ON quest.devnet_pass_minters
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_devnet_pass_minters();

-- Each newly verified mint is recorded once, in the same transaction that verifies it.
CREATE FUNCTION quest.record_devnet_pass_minter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest AS $$
BEGIN
 IF NEW.verified_at IS NOT NULL AND OLD.verified_at IS NULL THEN
  INSERT INTO quest.devnet_pass_minters (network, wallet, pass_mint, minted_at, source, evidence_sha256)
  VALUES (NEW.network, NEW.wallet, NEW.mint, NEW.verified_at, 'LIVE',
   encode(sha256(convert_to('devnet-pass-minter|' || NEW.wallet || '|' || NEW.mint || '|' ||
    extract(epoch FROM NEW.verified_at)::bigint, 'UTF8')), 'hex'))
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION quest.record_devnet_pass_minter() FROM PUBLIC;
CREATE TRIGGER pass_mint_verified_minter_record AFTER UPDATE OF verified_at ON quest.pass_mint_reservations
 FOR EACH ROW EXECUTE FUNCTION quest.record_devnet_pass_minter();

-- Mints that were verified before this migration, recorded once.
INSERT INTO quest.devnet_pass_minters (network, wallet, pass_mint, minted_at, source, evidence_sha256)
SELECT m.network, m.wallet, m.mint, m.verified_at, 'BACKFILL',
 encode(sha256(convert_to('devnet-pass-minter|' || m.wallet || '|' || m.mint || '|' ||
  extract(epoch FROM m.verified_at)::bigint, 'UTF8')), 'hex')
FROM quest.pass_mint_reservations m
WHERE m.verified_at IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
