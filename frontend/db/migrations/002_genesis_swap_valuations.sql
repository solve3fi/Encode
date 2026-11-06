-- One reviewed USD valuation per verified swap event. The valuation source
-- must provide price evidence and an observation time before this is populated.
BEGIN;

CREATE TABLE genesis.swap_valuations (
    campaign_id text NOT NULL,
    chain_event_id bigint NOT NULL,
    value_usd_cents numeric(38, 0) NOT NULL CHECK (value_usd_cents >= 0),
    price_observed_at timestamptz NOT NULL,
    valuation_source text NOT NULL CHECK (length(trim(valuation_source)) > 0),
    valuation_version text NOT NULL CHECK (length(trim(valuation_version)) > 0),
    price_evidence jsonb NOT NULL
        CHECK (jsonb_typeof(price_evidence) = 'object' AND price_evidence <> '{}'::jsonb),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, chain_event_id),
    FOREIGN KEY (campaign_id, chain_event_id)
        REFERENCES genesis.chain_events(campaign_id, id)
);

CREATE FUNCTION genesis.require_swap_valuation_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM genesis.chain_events
        WHERE campaign_id = NEW.campaign_id
          AND id = NEW.chain_event_id
          AND event_kind = 'swap'
    ) THEN
        RAISE EXCEPTION 'Genesis valuation must reference a verified swap event';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER swap_valuations_reference_swap BEFORE INSERT
    ON genesis.swap_valuations FOR EACH ROW
    EXECUTE FUNCTION genesis.require_swap_valuation_event();

CREATE TRIGGER swap_valuations_immutable BEFORE UPDATE OR DELETE
    ON genesis.swap_valuations FOR EACH ROW
    EXECUTE FUNCTION genesis.reject_immutable_change();

CREATE TRIGGER lp_value_snapshots_immutable BEFORE UPDATE OR DELETE
    ON genesis.lp_value_snapshots FOR EACH ROW
    EXECUTE FUNCTION genesis.reject_immutable_change();

COMMIT;
