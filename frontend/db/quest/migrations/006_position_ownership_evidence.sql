-- Dormant selected-position observations, not range coverage or XP authority.
BEGIN;
CREATE TABLE quest.position_ownership_evidence (
    campaign_id text NOT NULL REFERENCES quest.position_baseline_anchors(campaign_id),
    network text NOT NULL CHECK (network = 'DEVNET'),
    program_id text NOT NULL,
    decoder_version text NOT NULL CHECK (decoder_version = 'position-ownership-v1'),
    anchor_sha256 text NOT NULL CHECK (anchor_sha256 ~ '^[0-9a-f]{64}$'),
    signature text NOT NULL CHECK (length(signature) BETWEEN 1 AND 128),
    instruction_index bigint NOT NULL CHECK (instruction_index BETWEEN 0 AND 9007199254740991),
    position_address text NOT NULL,
    position_mint text NOT NULL,
    slot bigint NOT NULL CHECK (slot BETWEEN 0 AND 9007199254740991),
    transaction_index bigint NOT NULL CHECK (transaction_index BETWEEN 0 AND 9007199254740991),
    block_time_seconds bigint NOT NULL CHECK (block_time_seconds BETWEEN 0 AND 8640000000000),
    event_kind text NOT NULL CHECK (event_kind IN ('position_nft_transfer','position_close_observed')),
    source_key text NOT NULL CHECK (octet_length(source_key) <= 1024),
    evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
    evidence_record jsonb NOT NULL CHECK (jsonb_typeof(evidence_record) = 'object'
        AND octet_length(evidence_record::text) <= 16384),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id,signature,instruction_index,position_mint),
    UNIQUE (campaign_id,slot,transaction_index,instruction_index,position_mint)
);
REVOKE ALL ON quest.position_ownership_evidence FROM PUBLIC;
CREATE FUNCTION quest.check_position_ownership_anchor() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Serialize campaign evidence writers before checking identities across positions.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.campaign_id, 61746));
    IF EXISTS (SELECT 1 FROM quest.position_ownership_evidence e WHERE e.campaign_id=NEW.campaign_id
        AND ((e.slot=NEW.slot AND e.block_time_seconds<>NEW.block_time_seconds)
          OR (e.signature=NEW.signature AND (e.slot<>NEW.slot OR e.transaction_index<>NEW.transaction_index))
          OR (e.slot=NEW.slot AND e.transaction_index=NEW.transaction_index AND e.signature<>NEW.signature))) THEN
        RAISE EXCEPTION 'Position ownership block ordering conflicts';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM quest.position_baseline_anchors a
        WHERE a.campaign_id=NEW.campaign_id AND a.network=NEW.network
          AND a.program_id=NEW.program_id AND a.evidence_set_sha256=NEW.anchor_sha256
          AND NEW.slot > a.anchor_slot
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.evidence_bundle->'inventory') i
              WHERE i->>'positionAddress'=NEW.position_address AND i->>'positionMint'=NEW.position_mint)) THEN
        RAISE EXCEPTION 'Position ownership anchor pins or inventory differ';
    END IF;
    IF NOT (NEW.evidence_record @> jsonb_build_object(
        'network',NEW.network,'finality','finalized','campaignId',NEW.campaign_id,
        'programId',NEW.program_id,'signature',NEW.signature,
        'instructionIndex',NEW.instruction_index,'positionAddress',NEW.position_address,
        'positionMint',NEW.position_mint,'slot',NEW.slot,'transactionIndex',NEW.transaction_index,
        'blockTimeSeconds',NEW.block_time_seconds,'eventKind',NEW.event_kind)) THEN
        RAISE EXCEPTION 'Position ownership record metadata differs';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER position_ownership_anchor BEFORE INSERT ON quest.position_ownership_evidence
    FOR EACH ROW EXECUTE FUNCTION quest.check_position_ownership_anchor();
CREATE FUNCTION quest.reject_position_ownership_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Position ownership evidence is immutable';
END;
$$;
CREATE TRIGGER position_ownership_immutable BEFORE UPDATE OR DELETE ON quest.position_ownership_evidence
    FOR EACH ROW EXECUTE FUNCTION quest.reject_position_ownership_change();
CREATE TRIGGER position_ownership_no_truncate BEFORE TRUNCATE ON quest.position_ownership_evidence
    FOR EACH STATEMENT EXECUTE FUNCTION quest.reject_position_ownership_change();
COMMIT;
