-- Dormant, owner-only Genesis baseline. No Devnet writer or serving role has access.
-- Keep Devnet history intact: reset into a separate, explicitly pinned environment.
BEGIN;
CREATE SCHEMA quest_genesis;
REVOKE ALL ON SCHEMA quest_genesis FROM PUBLIC;
CREATE TABLE quest_genesis.resets (
 environment_id uuid PRIMARY KEY,
 genesis_hash text NOT NULL CHECK(genesis_hash ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND genesis_hash <> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),
 document jsonb NOT NULL,
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[0-9a-f]{64}$'),
 applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE quest_genesis.passports (
 environment_id uuid NOT NULL REFERENCES quest_genesis.resets(environment_id),
 passport_id uuid NOT NULL,
 PRIMARY KEY(environment_id,passport_id)
);
CREATE TABLE quest_genesis.mint_pass_completions (
 environment_id uuid NOT NULL,
 passport_id uuid NOT NULL,
 source_wallet text NOT NULL,
 source_pass_mint text NOT NULL,
 minted_at timestamptz NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(environment_id,passport_id),
 UNIQUE(environment_id,source_wallet), UNIQUE(environment_id,source_pass_mint),
 FOREIGN KEY(environment_id,passport_id) REFERENCES quest_genesis.passports
);
CREATE TABLE quest_genesis.xp_events (
 environment_id uuid NOT NULL,
 passport_id uuid NOT NULL,
 idempotency_key text NOT NULL,
 qualification_key text NOT NULL CHECK(qualification_key='mint-pass'),
 xp_delta bigint NOT NULL CHECK(xp_delta=250),
 PRIMARY KEY(environment_id,idempotency_key),
 UNIQUE(environment_id,passport_id,qualification_key),
 FOREIGN KEY(environment_id,passport_id) REFERENCES quest_genesis.mint_pass_completions
);
REVOKE ALL ON ALL TABLES IN SCHEMA quest_genesis FROM PUBLIC;
CREATE FUNCTION quest_genesis.guard_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Genesis baseline is immutable'; END; $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['resets','passports','mint_pass_completions','xp_events'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON quest_genesis.%I FOR EACH ROW EXECUTE FUNCTION quest_genesis.guard_history()',t);
  EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON quest_genesis.%I FOR EACH STATEMENT EXECUTE FUNCTION quest_genesis.guard_history()',t);
 END LOOP;
END $$;

CREATE FUNCTION quest_genesis.preview_reset(p_cutoff timestamptz,p_environment uuid,p_genesis text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest,quest_genesis SET timezone='UTC' AS $$
DECLARE body jsonb; identity jsonb;
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'Genesis reset requires a fresh read-committed transaction';
 END IF;
 IF p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff > clock_timestamp() OR p_environment IS NULL
    OR p_genesis IS NULL OR p_genesis !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
    OR p_genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' THEN
  RAISE EXCEPTION 'Explicit past cutoff and non-Devnet Genesis environment required';
 END IF;
 SELECT to_jsonb(e) - 'created_at' INTO STRICT identity FROM quest.environment_identity e;
 IF EXISTS(SELECT 1 FROM quest.devnet_pass_minters d LEFT JOIN quest.pass_mint_reservations m
   ON m.network=d.network AND m.wallet=d.wallet AND m.mint=d.pass_mint AND m.verified_at=d.minted_at
   WHERE d.minted_at<=p_cutoff AND m.passport_id IS NULL) THEN
  RAISE EXCEPTION 'Minter registry has no matching verified Passport reservation';
 END IF;
 IF EXISTS(SELECT 1 FROM quest.pass_mint_reservations m LEFT JOIN quest.devnet_pass_minters d
   ON m.network=d.network AND m.wallet=d.wallet AND m.mint=d.pass_mint AND m.verified_at=d.minted_at
   WHERE m.verified_at<=p_cutoff AND d.wallet IS NULL) THEN
  RAISE EXCEPTION 'Verified mint is missing from permanent registry';
 END IF;
 body := jsonb_build_object('schemaVersion',1,'source',identity,'targetEnvironment',p_environment,
  'targetNetwork','MAINNET','targetGenesis',p_genesis,'cutoff',p_cutoff,'mintPassXp',250,
  'passports',COALESCE((SELECT jsonb_agg(passport_id ORDER BY passport_id) FROM quest.passports WHERE created_at<=p_cutoff),'[]'::jsonb),
  'minters',COALESCE((SELECT jsonb_agg(jsonb_build_object('passportId',m.passport_id,'wallet',d.wallet,
   'passMint',d.pass_mint,'mintedAt',d.minted_at,'evidenceSha256',d.evidence_sha256) ORDER BY m.passport_id)
   FROM quest.devnet_pass_minters d JOIN quest.pass_mint_reservations m
   ON m.network=d.network AND m.wallet=d.wallet AND m.mint=d.pass_mint AND m.verified_at=d.minted_at
   WHERE d.minted_at<=p_cutoff),'[]'::jsonb));
 RETURN jsonb_build_object('body',body,'documentSha256',encode(sha256(convert_to(body::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION quest_genesis.preview_reset(timestamptz,uuid,text) FROM PUBLIC;

CREATE FUNCTION quest_genesis.apply_reset(p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,quest,quest_genesis SET timezone='UTC' AS $$
DECLARE body jsonb := p_document->'body'; target uuid := (body->>'targetEnvironment')::uuid;
 previous quest_genesis.resets%ROWTYPE; expected jsonb;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'Reset document required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target::text,61750));
 SELECT * INTO previous FROM quest_genesis.resets WHERE environment_id=target;
 IF FOUND THEN
  IF previous.document IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'Genesis environment already initialized with a different document'; END IF;
  RETURN jsonb_build_object('created',false,'environmentId',target,'documentSha256',previous.document_sha256);
 END IF;
 LOCK TABLE quest.passports,quest.pass_mint_reservations,quest.devnet_pass_minters IN SHARE MODE;
 expected := quest_genesis.preview_reset((body->>'cutoff')::timestamptz,target,body->>'targetGenesis');
 IF expected IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'Reset document is stale, incomplete or tampered'; END IF;
 INSERT INTO quest_genesis.resets VALUES(target,body->>'targetGenesis',p_document,p_document->>'documentSha256',clock_timestamp());
 INSERT INTO quest_genesis.passports SELECT target,x::uuid FROM jsonb_array_elements_text(body->'passports') x;
 INSERT INTO quest_genesis.mint_pass_completions
 SELECT target,(x->>'passportId')::uuid,x->>'wallet',x->>'passMint',(x->>'mintedAt')::timestamptz,x->>'evidenceSha256'
 FROM jsonb_array_elements(body->'minters') x;
 INSERT INTO quest_genesis.xp_events
 SELECT target,passport_id,'genesis:mint-pass:'||passport_id,'mint-pass',250
 FROM quest_genesis.mint_pass_completions WHERE environment_id=target;
 RETURN jsonb_build_object('created',true,'environmentId',target,'documentSha256',p_document->>'documentSha256');
END $$;
REVOKE ALL ON FUNCTION quest_genesis.apply_reset(jsonb) FROM PUBLIC;
COMMIT;
