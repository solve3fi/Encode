-- Dormant reconciliation publication boundaries; no anchor, campaign or grants.
-- Apply with a migration role. Existing cursors require an operator-reviewed
-- starting slot before any reconciliation watermark can be published.
BEGIN;

ALTER TABLE genesis.indexer_cursors
    ADD COLUMN reconciliation_start_slot bigint,
    ADD CONSTRAINT reconciliation_start_bounds CHECK (
        reconciliation_start_slot IS NULL OR
        (reconciliation_start_slot >= 0 AND reconciliation_start_slot <= next_slot)
    ),
    ADD CONSTRAINT reconciliation_watermark_bounds CHECK (
        reconciled_through_slot IS NULL OR
        (reconciliation_start_slot IS NOT NULL AND
         reconciled_through_slot >= reconciliation_start_slot AND
         reconciled_through_slot < next_slot)
    );

CREATE FUNCTION genesis.preserve_reconciliation_start() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.reconciliation_start_slot IS NOT NULL AND
       NEW.reconciliation_start_slot IS DISTINCT FROM OLD.reconciliation_start_slot THEN
        RAISE EXCEPTION 'Genesis reconciliation starting slot is immutable once pinned';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_start_immutable BEFORE UPDATE
    ON genesis.indexer_cursors FOR EACH ROW
    EXECUTE FUNCTION genesis.preserve_reconciliation_start();

-- Lock every campaign cursor in a deterministic order. Events do not carry a
-- program ID, so conservative invalidation covers all campaign decoders.
-- If publication owns the row lock first, this waits and then invalidates the
-- just-published watermark. If insertion owns it first, publication sees the
-- committed event/conflict using READ COMMITTED after acquiring its lock.
CREATE FUNCTION genesis.invalidate_reconciliation_watermarks() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    affected_campaign text;
    affected_slot bigint;
    locked_cursor record;
BEGIN
    IF TG_TABLE_NAME = 'chain_events' THEN
        affected_campaign := NEW.campaign_id;
        affected_slot := NEW.slot;
    ELSE
        IF NEW.resolution <> 'open' THEN RETURN NEW; END IF;
        SELECT campaign_id, slot INTO STRICT affected_campaign, affected_slot
            FROM genesis.chain_events WHERE id = NEW.existing_event_id;
    END IF;

    FOR locked_cursor IN
        SELECT campaign_id, program_id, decoder_version FROM genesis.indexer_cursors
        WHERE campaign_id = affected_campaign
        ORDER BY program_id, decoder_version FOR UPDATE
    LOOP
        UPDATE genesis.indexer_cursors
        SET reconciled_through_slot = CASE
                WHEN affected_slot > reconciliation_start_slot THEN affected_slot - 1
                ELSE NULL END,
            updated_at = now()
        WHERE campaign_id = locked_cursor.campaign_id
          AND program_id = locked_cursor.program_id
          AND decoder_version = locked_cursor.decoder_version
          AND reconciled_through_slot >= affected_slot;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER event_reconciliation_invalidation AFTER INSERT
    ON genesis.chain_events FOR EACH ROW
    EXECUTE FUNCTION genesis.invalidate_reconciliation_watermarks();
CREATE TRIGGER conflict_reconciliation_invalidation AFTER INSERT OR UPDATE
    ON genesis.ingest_conflicts FOR EACH ROW
    EXECUTE FUNCTION genesis.invalidate_reconciliation_watermarks();

COMMIT;
