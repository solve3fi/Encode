-- A trusted reconciler asserts that every wallet position and valuation change
-- through this slot/time has a value-after snapshot, including ownership exits.
-- Snapshot counts detect later backfills into an already published interval.
BEGIN;

CREATE TABLE genesis.lp_snapshot_coverage (
    campaign_id text NOT NULL REFERENCES genesis.campaigns(id),
    wallet text NOT NULL,
    through_slot bigint NOT NULL CHECK (through_slot >= 0),
    through_at timestamptz NOT NULL,
    snapshot_count bigint NOT NULL CHECK (snapshot_count >= 0),
    valuation_source text NOT NULL CHECK (length(trim(valuation_source)) > 0),
    valuation_version text NOT NULL CHECK (length(trim(valuation_version)) > 0),
    published_by text NOT NULL CHECK (length(trim(published_by)) > 0),
    published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, wallet, through_slot)
);

CREATE TRIGGER lp_snapshot_coverage_immutable BEFORE UPDATE OR DELETE
    ON genesis.lp_snapshot_coverage FOR EACH ROW
    EXECUTE FUNCTION genesis.reject_immutable_change();

COMMIT;
