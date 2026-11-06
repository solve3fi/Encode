-- Export of the permanent Devnet Pass minter record, as one JSON document on standard output. Run it as the
-- database owner on the Quest database and commit the output (docs/mainnet-carryover/devnet-pass-minters.json):
--
--   docker exec -i solve3-quest-quest-db-1 psql -U postgres -d quest_devnet -At -f - \
--     < scripts/quest/export-devnet-pass-minters.sql > docs/mainnet-carryover/devnet-pass-minters.json
--
-- It lists only who minted: wallet, Pass mint, verified time and the evidence hash. No XP, no Passport id.
-- `documentSha256` covers the minters array in wallet order, so a later copy can be compared exactly.
WITH minters AS (
 SELECT wallet, pass_mint, minted_at, source, evidence_sha256
 FROM quest.devnet_pass_minters WHERE network = 'DEVNET' ORDER BY wallet
), body AS (
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'wallet', wallet,
  'passMint', pass_mint,
  'mintedAt', to_char(minted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'evidenceSha256', evidence_sha256
 ) ORDER BY wallet), '[]'::jsonb) AS minters FROM minters
)
SELECT jsonb_pretty(jsonb_build_object(
 'record', 'devnet-pass-minters',
 'network', 'DEVNET',
 'purpose', 'Wallets that minted the Devnet Solve3 Pass. To be awarded XP for the Pass mint when Solve3 is live on mainnet. No other Devnet XP carries over.',
 'count', jsonb_array_length(body.minters),
 'documentSha256', encode(sha256(convert_to(body.minters::text, 'UTF8')), 'hex'),
 'minters', body.minters
)) FROM body;
