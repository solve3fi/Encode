# Devnet Quest/Pass test backend

Isolated, Devnet-only backend for the signed Quest and Pass test panels. It composes durable Passport auth and the calendar service over a dedicated PostgreSQL database. Optional public enrollment and user-paid non-transferable Pass mint authorization are described below. It awards no live XP and exposes no operator endpoint. The server never funds or submits mint transactions.

## Layout

| File | Purpose |
|---|---|
| `quest-test-server.mjs` | The HTTP server (bun). Verifies the database identity and serving-role privileges at startup, then serves `/passport/*`, `/calendar/snapshot|history` and `/healthz`. |
| `apply-schema.mjs` | One-time, idempotent schema setup as the **owner** role: Genesis 001-004 (both historic 003 files), Quest 001-014, the immutable environment identity row and least-privilege grants. |
| `provision.mjs` | Operator tool (never over HTTP): links public tester wallets to new test Passports and publishes the synthetic calendar through the real service using a throwaway operator whose grant lasts two hours. |
| `setup-host.sh` | Generates all secrets on the host into `/etc/solve3/quest/*.env` (root, 0600). Idempotent. |
| `docker-compose.yml`, `Dockerfile` | `quest-db` (postgres:16-alpine, no published port) and `quest-backend`. |
| `devnet-manifest.json` | Operator-attested candidate manifest whose sha256 is pinned in the database identity. Not an approved program manifest. |

## First-time setup (already done on the production host, 2026-10-04)

1. Ship `deploy/quest-backend`, `db/`, `scripts/quest` (no tests), `scripts/genesis-migrate.mjs` and `src/lib/genesis` to `/srv/solve3`.
2. `QUEST_BACKEND_ORIGIN=https://<backend host> ./setup-host.sh`.
3. `docker compose up -d quest-db`, then create the roles `quest_owner`, `quest_runtime`, `quest_operator` (LOGIN, no superuser/createdb/createrole) and the database `quest_devnet` owned by `quest_owner`, with passwords from `secrets.env`.
4. `docker compose build quest-backend`.
5. `docker run --rm --network solve3-quest_internal --env-file /etc/solve3/quest/tools.env solve3-quest-backend:local bun server/apply-schema.mjs`
6. `docker run ... -e QUEST_TEST_WALLETS=<public address[,address]> solve3-quest-backend:local bun server/provision.mjs`
7. `docker compose up -d quest-backend`; add the Caddy block that proxies `/passport/*`, `/calendar/*` and `/healthz` to `quest-backend:8080`.
8. Website: set the three server-only variables and the build-time `NEXT_PUBLIC_QUEST_TEST_CAMPAIGN` from `public.env`, rebuild and restart the site.

## Add a tester

With public enrollment disabled, provision the public address (step 6) before sign-in. With enrollment enabled, a new wallet creates its test Passport only after its signature is verified. To remove a tester, close the wallet link with an evidence hash (`UPDATE quest.wallet_links SET unlinked_at=clock_timestamp(), unlink_evidence_sha256=<sha256> WHERE wallet=...`, as the owner). A permanently bound wallet cannot self-register again after unlinking. The link history is append-only.

## Optional public enrollment and user-paid Pass rollout

These changes require a separate approved host rollout; merging code does not deploy it. Back up PostgreSQL and tag the current backend and website images before beginning. Keep the ordinary website network default unchanged.

1. Create a separate LOGIN role for enrollment with no superuser, role creation, database creation or direct Passport/binding/link INSERT permissions. Put its private connection URL in the host's protected backend environment file as `QUEST_ENROLLMENT_DB_URL`. Set `QUEST_ENROLLMENT_ROLE` in the owner-only schema-tool environment, then run `apply-schema.mjs` as the schema owner. It appends migrations 015/016 to the deployed 001..014 schema, using table-presence markers. Those markers are not a checksum-based migration history: verify the original deployed schema and the new tables before enabling features. The script grants this separate role only environment reads and rate/enrollment function execution. The ordinary serving role gets reservation access but retains no identity-creation powers.
2. Enable backend `QUEST_PUBLIC_ENROLLMENT=true`. The application verifies the real Ed25519 signature before invoking the narrow database capability; SQL does not perform cryptographic signature verification. Proofs are immutable and consumed once. Identity and wallet-link creation use the consumption time, never an earlier source-attribution time. Both global and wallet counters apply; the 600/hour enrollment bucket is consumed at challenge and completion, so it is not a promise of 600 new wallets/hour.
3. Generate the mint derivation/authorization key exactly once with `create-pass-authority.mjs`, setting `QUEST_PASS_AUTHORITY_FILE` to `/etc/solve3/quest/pass-authority.json` for that operator invocation. The tool refuses to overwrite an existing key. Keep a protected backup permanently: changing it invalidates existing reservations. Inspect the image's actual runtime UID/GID and give that user ownership of the regular 0600 file. Do not print or copy its contents into a handoff. This key needs **no SOL funding**.
4. Start with both compose files (`docker-compose.yml` and `docker-compose.public.yml`). The override mounts the key read-only at `/run/secrets/pass-authority.json` and refuses to create a missing host path. Set backend `QUEST_PASS_AUTHORITY_FILE=/run/secrets/pass-authority.json`, `QUEST_PASS_MINT_ENABLED=true` and an HTTPS `QUEST_DEVNET_RPC_URL`. Startup checks the Devnet genesis hash. Use a bounded reliable RPC, keeping any private provider credential server-side.
5. Add only `/pass/prepare` and `/pass/status` to the backend Caddy proxy paths, alongside the existing Passport/calendar/health paths. The website gateway allow-list includes enrollment, session resume and these two Pass operations. Every private read/preparation still needs the signed session, exact Origin and CSRF; there is no bare-address read endpoint.
6. Rebuild the website with `NEXT_PUBLIC_QUEST_PASS_MINT_ENABLED=true` and its existing test campaign. Existing server gateway configuration still applies. On Quests/Pass, connected Devnet wallets get one message prompt; rejection is remembered until explicit retry or reconnect. Existing recoverable cookie sessions load without another message. Legacy random-CSRF sessions need one fresh sign-in. Other pages do not automatically request a Quest message.
7. Test over real HTTPS with a new user-controlled wallet: sign once, navigate Quests to Pass, reload, reject/retry, disconnect/switch wallets, and check 375px layout. The user must have Devnet SOL. First click reviews the exact upper cost bound; the second asks the wallet to sign. The wallet pays both transaction fees and mint/token-account rent. Verify finalized Token-2022 ownership, supply one, decimals zero, revoked mint authority, non-transferability and metadata before accepting the displayed Minted state. No XP is awarded by minting.

The database reserves one deterministic mint per wallet/Passport. Concurrent preparations reuse the same partially signed transaction until its blockhash window expires. An existing confirmed mint waits for finalization; an already verified Pass that was burned is not reminted. Initial metadata is the test Explorer artwork, not a live tier-upgrade promise. Browser cost previews and transaction approvals are distinct from the sign-in message.

Rollback: disable the public enrollment and Pass flags, redeploy the tagged previous backend and website images, and retain the additive tables, reservations and key backup. Do not drop append-only records or regenerate the authority key. Independently verify health and the existing provisioned-wallet sign-in after rollback. Existing source-evidence and live-XP blockers remain open.

## Trust and limits

- The serving login has no create/identity powers; the server refuses to start otherwise.
- Every request arrives through the website's own server-side gateway (`/api/quest-test/...`), so the only trusted client identity is that gateway. Browser-supplied forwarding headers are ignored, and all testers share one rate bucket: 600/h challenge, 600/h authenticate, 6000/h session.
- Origin must equal the canonical website origin (`https://solve3.fi`); other origins (including `www`) are refused.
- The database stores no private keys and the provisioning operator's key is never written anywhere.

## Disable or roll back

- Gateway only: set `QUEST_TEST_UI_ENABLED=false` in `/etc/solve3/quest/public.env`, then `docker compose up -d app` in `/srv/solve3-deploy`.
- Backend: `docker compose down` here (the `quest_pgdata` volume is kept).
- Changing the backend hostname: update the Caddyfile block, `QUEST_TEST_BACKEND_ORIGIN` and rebuild nothing else (it is a server-side variable); the website origin and the database identity do not change.

## Operator smoke CLI

Use a disposable private test-wallet file under /tmp with mode 0600; never request a user's wallet keys. The reusable smoke CLI verifies canonical challenges, signed enrollment/authentication, session resume, private snapshot, cached preparation and logout. By default it submits no chain transaction. After funding that disposable wallet with Devnet SOL, explicitly add --mint=true for finalized user-paid mint and backend verification:

    node scripts/quest/smoke-public-pass.mjs --wallet-file=/tmp/test-wallet.json --mint=true

The default target is the canonical HTTPS website. The explicit localhost transport options are for isolated operator staging only and do not count as public HTTPS smoke evidence. Keep the disposable key private until any pending test funding/mint verification is complete; no cookie, CSRF or signature is logged.
