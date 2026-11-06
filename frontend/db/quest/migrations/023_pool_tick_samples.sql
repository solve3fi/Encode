-- Devnet TEST range-aware LP quests. A liquidity position only earns while the pool's price is inside its
-- tick range, so the LP quest must know where each featured pool's price was over time. The worker samples
-- each featured pool's current tick (finalized) and records it here. A row is written when the tick changes,
-- and at least every few minutes as a heartbeat while it does not, so a quiet pool stays continuous without
-- the table growing every minute. Append-only: a sample is evidence and never edited. Append-only upgrade of
-- 001..022.
BEGIN;

CREATE FUNCTION quest.guard_pool_tick_samples() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,quest AS $$
BEGIN
 RAISE EXCEPTION 'Pool tick samples are append-only';
END;
$$;

CREATE TABLE quest.pool_tick_samples (
 network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
 pool_address text NOT NULL CHECK (length(pool_address) BETWEEN 32 AND 44 AND pool_address ~ '^[1-9A-HJ-NP-Za-km-z]+$'),
 observed_slot bigint NOT NULL CHECK (observed_slot >= 0),
 observed_at timestamptz NOT NULL,
 tick_current_index integer NOT NULL CHECK (tick_current_index BETWEEN -443636 AND 443636),
 PRIMARY KEY (network, pool_address, observed_slot)
);
CREATE INDEX pool_tick_samples_by_time ON quest.pool_tick_samples (network, pool_address, observed_at);
REVOKE ALL ON quest.pool_tick_samples FROM PUBLIC;
CREATE TRIGGER pool_tick_samples_immutable BEFORE UPDATE OR DELETE ON quest.pool_tick_samples
 FOR EACH ROW EXECUTE FUNCTION quest.guard_pool_tick_samples();
CREATE TRIGGER pool_tick_samples_no_truncate BEFORE TRUNCATE ON quest.pool_tick_samples
 FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_pool_tick_samples();

COMMIT;
