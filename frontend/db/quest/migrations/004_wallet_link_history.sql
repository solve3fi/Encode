-- Dormant Devnet wallet ownership and link history. No runtime grants or
-- live link/unlink route are created. Apply after 003_passport_challenge_session.
-- Rollback after dependent code is removed: drop wallet_links, then
-- wallet_bindings, then the guard functions below.
BEGIN;

-- A wallet is permanently bound to its first Passport until a separately
-- reviewed recovery process exists. Unlinking does not free this binding.
CREATE TABLE quest.wallet_bindings (
    network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
    wallet text NOT NULL CHECK (
        length(wallet) BETWEEN 32 AND 44 AND
        wallet ~ '^[1-9A-HJ-NP-Za-km-z]+$'
    ),
    passport_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (network, wallet),
    UNIQUE (network, wallet, passport_id),
    FOREIGN KEY (network, passport_id)
        REFERENCES quest.passports (network, passport_id)
);

CREATE TABLE quest.wallet_links (
    link_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    network text NOT NULL DEFAULT 'DEVNET' CHECK (network = 'DEVNET'),
    wallet text NOT NULL,
    passport_id uuid NOT NULL,
    linked_at timestamptz NOT NULL DEFAULT now(),
    unlinked_at timestamptz,
    link_evidence_sha256 text NOT NULL CHECK (
        link_evidence_sha256 ~ '^[0-9a-f]{64}$'
    ),
    unlink_evidence_sha256 text CHECK (
        unlink_evidence_sha256 IS NULL OR
        unlink_evidence_sha256 ~ '^[0-9a-f]{64}$'
    ),
    FOREIGN KEY (network, wallet, passport_id)
        REFERENCES quest.wallet_bindings (network, wallet, passport_id),
    CHECK (unlinked_at IS NULL OR unlinked_at > linked_at),
    CHECK ((unlinked_at IS NULL) = (unlink_evidence_sha256 IS NULL))
);
CREATE UNIQUE INDEX wallet_links_one_active_wallet
    ON quest.wallet_links (network, wallet)
    WHERE unlinked_at IS NULL;
CREATE INDEX wallet_links_event_time
    ON quest.wallet_links (network, wallet, linked_at, unlinked_at);
CREATE INDEX wallet_links_passport
    ON quest.wallet_links (network, passport_id, linked_at DESC);

CREATE FUNCTION quest.guard_wallet_binding_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Wallet binding is immutable';
END;
$$;
CREATE TRIGGER wallet_bindings_immutable
    BEFORE UPDATE OR DELETE ON quest.wallet_bindings
    FOR EACH ROW EXECUTE FUNCTION quest.guard_wallet_binding_mutation();
CREATE TRIGGER wallet_bindings_no_truncate
    BEFORE TRUNCATE ON quest.wallet_bindings
    FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_wallet_binding_mutation();

-- Lock the permanent binding row before checking historical intervals. This
-- serializes concurrent inserts for the same wallet without an extension.
CREATE FUNCTION quest.guard_wallet_link_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM quest.wallet_bindings
    WHERE network = NEW.network AND wallet = NEW.wallet AND
          passport_id = NEW.passport_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet binding required before link';
    END IF;
    IF EXISTS (
        SELECT 1 FROM quest.wallet_links existing
        WHERE existing.network = NEW.network AND existing.wallet = NEW.wallet
          AND tstzrange(existing.linked_at, existing.unlinked_at, '[)') &&
              tstzrange(NEW.linked_at, NEW.unlinked_at, '[)')
    ) THEN
        RAISE EXCEPTION 'Wallet link interval overlaps history';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_links_no_overlap
    BEFORE INSERT ON quest.wallet_links
    FOR EACH ROW EXECUTE FUNCTION quest.guard_wallet_link_insert();

-- A link can be closed once. Signed evidence, identity, and dates cannot be
-- replaced or reopened by an ordinary mutation.
CREATE FUNCTION quest.guard_wallet_link_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.unlinked_at IS NOT NULL OR NEW.unlinked_at IS NULL OR
       NEW.unlink_evidence_sha256 IS NULL OR
       ROW(NEW.link_id, NEW.network, NEW.wallet, NEW.passport_id,
           NEW.linked_at, NEW.link_evidence_sha256)
       IS DISTINCT FROM
       ROW(OLD.link_id, OLD.network, OLD.wallet, OLD.passport_id,
           OLD.linked_at, OLD.link_evidence_sha256) THEN
        RAISE EXCEPTION 'Wallet link may only be closed once';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER wallet_links_one_close
    BEFORE UPDATE ON quest.wallet_links
    FOR EACH ROW EXECUTE FUNCTION quest.guard_wallet_link_update();
CREATE TRIGGER wallet_links_no_delete
    BEFORE DELETE ON quest.wallet_links
    FOR EACH ROW EXECUTE FUNCTION quest.guard_wallet_binding_mutation();
CREATE TRIGGER wallet_links_no_truncate
    BEFORE TRUNCATE ON quest.wallet_links
    FOR EACH STATEMENT EXECUTE FUNCTION quest.guard_wallet_binding_mutation();

REVOKE ALL ON quest.wallet_bindings, quest.wallet_links FROM PUBLIC;
REVOKE ALL ON SEQUENCE quest.wallet_links_link_id_seq FROM PUBLIC;
COMMIT;
