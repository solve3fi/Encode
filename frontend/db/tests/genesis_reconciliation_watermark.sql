-- Apply Genesis migrations 001-003 to an empty disposable test database first.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
    IF current_database() !~ '^genesis_q4_it_[a-z0-9_]+$' THEN
        RAISE EXCEPTION 'Reconciliation tests require genesis_q4_it_* database';
    END IF;
    IF EXISTS (SELECT 1 FROM genesis.campaigns) THEN
        RAISE EXCEPTION 'Reconciliation tests require empty campaign tables';
    END IF;
END;
$$;

INSERT INTO genesis.campaigns (id, cluster) VALUES ('test-genesis', 'devnet');
INSERT INTO genesis.indexer_cursors
    (campaign_id, program_id, decoder_version, next_slot)
    VALUES ('test-genesis', 'test-program', 'decoder-1', 20);

DO $$
BEGIN
    BEGIN
        UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15;
        RAISE EXCEPTION 'Unpinned watermark unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END;
$$;
UPDATE genesis.indexer_cursors SET reconciliation_start_slot = 10;
DO $$
BEGIN
    BEGIN
        UPDATE genesis.indexer_cursors SET reconciliation_start_slot = 11;
        RAISE EXCEPTION 'Anchor rewrite unexpectedly accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'Genesis reconciliation starting slot is immutable once pinned' THEN RAISE; END IF;
    END;
    BEGIN
        UPDATE genesis.indexer_cursors SET reconciled_through_slot = 9;
        RAISE EXCEPTION 'Watermark before anchor unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE genesis.indexer_cursors SET reconciled_through_slot = 20;
        RAISE EXCEPTION 'Watermark beyond ingest unexpectedly accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
END;
$$;

UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15;
INSERT INTO genesis.chain_events
    (campaign_id, cluster, signature, instruction_index, event_index, event_kind,
     slot, block_time, wallet, payload, event_sha256, decoder_version, verified_at)
    VALUES ('test-genesis', 'devnet', 'event-12', 0, 0, 'swap', 12,
            to_timestamp(1700000000), 'test-wallet', '{}', repeat('a', 64), 'decoder-1', now());
DO $$
BEGIN
    IF (SELECT reconciled_through_slot FROM genesis.indexer_cursors) IS DISTINCT FROM 11::bigint THEN
        RAISE EXCEPTION 'Late event did not invalidate watermark';
    END IF;
END;
$$;

UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15;
INSERT INTO genesis.ingest_conflicts
    (existing_event_id, observed_event_sha256, observed_decoder_version)
    SELECT id, repeat('b', 64), 'decoder-1' FROM genesis.chain_events;
DO $$
BEGIN
    IF (SELECT reconciled_through_slot FROM genesis.indexer_cursors) IS DISTINCT FROM 11::bigint THEN
        RAISE EXCEPTION 'Open conflict did not invalidate watermark';
    END IF;
END;
$$;

-- Resolving evidence does not certify the range; it must be reconciled again.
UPDATE genesis.ingest_conflicts SET resolution = 'source_error', resolved_at = now();
DO $$
BEGIN
    IF (SELECT reconciled_through_slot FROM genesis.indexer_cursors) IS DISTINCT FROM 11::bigint THEN
        RAISE EXCEPTION 'Resolution restored watermark without comparison';
    END IF;
END;
$$;
UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15;
UPDATE genesis.ingest_conflicts SET resolution = 'open', resolved_at = NULL;
DO $$
BEGIN
    IF (SELECT reconciled_through_slot FROM genesis.indexer_cursors) IS DISTINCT FROM 11::bigint THEN
        RAISE EXCEPTION 'Reopened conflict did not invalidate watermark';
    END IF;
END;
$$;

INSERT INTO genesis.indexer_cursors
    (campaign_id, program_id, decoder_version, next_slot, reconciliation_start_slot, reconciled_through_slot)
    VALUES ('test-genesis', 'test-program', 'decoder-2', 20, 10, 15);
UPDATE genesis.indexer_cursors SET reconciled_through_slot = 15;
INSERT INTO genesis.chain_events
    (campaign_id, cluster, signature, instruction_index, event_index, event_kind,
     slot, block_time, wallet, payload, event_sha256, decoder_version, verified_at)
    VALUES ('test-genesis', 'devnet', 'event-10', 0, 0, 'swap', 10,
            to_timestamp(1700000000), 'test-wallet', '{}', repeat('c', 64), 'decoder-1', now());
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM genesis.indexer_cursors WHERE reconciled_through_slot IS NOT NULL) THEN
        RAISE EXCEPTION 'Event at anchor did not invalidate all campaign decoders';
    END IF;
END;
$$;

-- Future-slot ingest must leave already reconciled ranges intact.
UPDATE genesis.indexer_cursors SET reconciled_through_slot = 11;
INSERT INTO genesis.chain_events
    (campaign_id, cluster, signature, instruction_index, event_index, event_kind,
     slot, block_time, wallet, payload, event_sha256, decoder_version, verified_at)
    VALUES ('test-genesis', 'devnet', 'event-16', 0, 0, 'swap', 16,
            to_timestamp(1700000000), 'test-wallet', '{}', repeat('d', 64), 'decoder-1', now());
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM genesis.indexer_cursors WHERE reconciled_through_slot IS DISTINCT FROM 11::bigint) THEN
        RAISE EXCEPTION 'Future event changed earlier watermark';
    END IF;
END;
$$;
ROLLBACK;
