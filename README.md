# Solve3 on Solana | Encode

Solve3 is a community-directed DEX on Solana. Traders swap, liquidity providers earn fees and emissions, and SOLV3 lockers vote in the Epoch Arena to direct those emissions. Quests guide newcomers, and Clans rally members behind pools.

## Live deployments

- **Mainnet** is live at [Solve3.fi](https://solve3.fi).
- **Devnet** is live at [dev.solve3.fi](https://dev.solve3.fi). This repository mirrors the devnet app, which runs on Solana devnet with test tokens.

[Watch the Encode demo](https://youtu.be/vvV6mAKozQU)

## Run the devnet frontend

Install Node.js 24 and Bun. The container build pins Bun 1.3.14. Run these commands from a clean checkout.

```sh
git clone https://github.com/solve3fi/Encode.git
cd Encode/frontend
CI=true LEFTHOOK=0 bun install --frozen-lockfile --ignore-scripts
bun run --cwd packages/common build
bun run --cwd packages/sdk build
bun run --cwd packages/solve3 build
```

Create `frontend/.env.local` with these settings for the full dev interface.

```dotenv
NEXT_PUBLIC_CLUSTER=devnet
NEXT_PUBLIC_SITE_VARIANT=dev
NEXT_PUBLIC_DEV_SITE_URL=http://localhost:3000
NEXT_PUBLIC_LAUNCH_PHASE=full
NEXT_PUBLIC_AGENT_ENABLED=1
NEXT_PUBLIC_QUEST_TEST_CAMPAIGN=solve3-devnet-test-2026
```

Run `bun run compile` and `bun run dev --hostname localhost`, then open [localhost:3000](http://localhost:3000). For a production build, run `bun run build` and then `bun run start --hostname localhost`. Next.js embeds the `NEXT_PUBLIC_*` settings at build time. The frontend defaults to the public Solana devnet RPC. Use a devnet wallet and test tokens to submit transactions. You can use the existing deployments below from a local checkout.

For a container, use the root Dockerfile **inside `frontend/`**, which includes the ALM preview assets.

```sh
docker build -t solve3-encode-dev \
  --build-arg NEXT_PUBLIC_CLUSTER=devnet \
  --build-arg NEXT_PUBLIC_DEV_SITE_URL=http://localhost:3000 \
  --build-arg NEXT_PUBLIC_QUEST_TEST_CAMPAIGN=solve3-devnet-test-2026 .
docker run --rm -p 3000:3000 solve3-encode-dev
```

## Configure the hosted services

| Feature | Configuration |
| --- | --- |
| Swap, liquidity, locks, votes and claims | Uses the devnet programs below. Set `NEXT_PUBLIC_DEV_SITE_URL` to the exact frontend origin for your build. `SOLVE3_DEVNET_RPC_URL` is the server-side RPC override. |
| Just Ask | `NEXT_PUBLIC_AGENT_ENABLED=1`. Open it in the header. A wallet still reviews and signs transactions. |
| Signed Quests, Pass and Clans | Set up PostgreSQL 16 and the Quest backend using the steps below. A local HTTP frontend can show the UI. The signed gateway requires two distinct HTTPS origins. |
| Aurora Intents | See [Aurora Intents nudges](#aurora-intents-nudges) for the controls and configuration. |
| ALM and Yield Hunter | Preview pages are included. The ALM interactive preview uses the bundled `alm-beta/` assets and the configured dev site host. Set `ALM_BETA_ENABLED=0` to disable it. |

### Quest backend and Clan rallies

1. On the isolated dev host, stage `frontend/` at `/srv/solve3` for the supplied Compose file. Create or reuse the external Docker network `solve3-production_web`. From `deploy/quest-backend/`, run `bash setup-host.sh` as root with `QUEST_WEB_ORIGIN` set to the exact HTTPS frontend origin, `QUEST_BACKEND_ORIGIN` set to a distinct HTTPS backend origin, and `QUEST_CAMPAIGN_ID` matching the frontend build. The script generates protected host env files.
2. Start `quest-db` with `docker compose up -d quest-db`. In PostgreSQL, create the `quest_owner`, `quest_runtime` and `quest_operator` login roles with passwords from the generated host file, and a `quest_devnet` database owned by `quest_owner`. Use non-superuser roles without database or role creation privileges.
3. Build with `docker compose build quest-backend`. Apply the schema as the owner using the generated tools environment. It installs the Genesis prerequisites and Quest migrations through `034_clan_rallies.sql`, with `033_clans.sql` providing the base Clan schema.

   ```sh
   docker run --rm --network solve3-quest_internal \
     --env-file /etc/solve3/quest/tools.env \
     solve3-quest-backend:local bun server/apply-schema.mjs
   ```

4. Use `server/provision.mjs` in the same image and tools environment with `QUEST_TEST_WALLETS` set to the public addresses of your testers. Then start `quest-backend`. Route `/passport/*`, `/calendar/*` and `/healthz` on the backend HTTPS origin to port 8080. For public enrollment and user-paid minting, follow the [backend runbook](frontend/deploy/quest-backend/README.md), including its additional roles, `/pass/*` routes and key setup.
5. Set `QUEST_TEST_UI_ENABLED=true`, `QUEST_TEST_WEB_ORIGIN` and `QUEST_TEST_BACKEND_ORIGIN` in the website server environment. Use exact HTTPS origins without a path or trailing slash. Set `NEXT_PUBLIC_QUEST_TEST_CAMPAIGN` at build time. Load `/quests?tab=clans` and sign in with a test wallet.
6. For live rally counts, set `QUEST_DEVNET_RPC_URL` in the backend environment, then run `bash setup-swap-source.sh` with `QUEST_SWAP_PROGRAM_ID` set to the devnet DEX address below. Add `QUEST_VE_PROGRAM_ID` with the devnet `vesolve` address to `/etc/solve3/quest/swap.env`, then start `quest-swap-worker` with the base Compose file and `docker-compose.swap.yml`. The worker records the vote allocations that Clan rallies count. Configure the XP settler and optional LP feed using the companion host scripts when testing those Quest progress sources.

## Aurora Intents nudges

When a trader, liquidity provider, or partner comes up short, Solve3 points them to funding from another chain right where they hit the shortfall.

| Where | What to look for |
| --- | --- |
| Swap | Connect a wallet and enter more SOL or USDC than it holds. The amount field shows the shortfall and a funding link. A separate prompt appears when the wallet is low on SOL. |
| Add Liquidity | Enter more than the wallet holds on either supported side of the pair. The funding link appears beside that amount. |
| Add Incentive (`/bribes`) | Look for **Fund your incentive from any chain** above the form. A supported shortfall also appears beside the incentive amount. |
| Locks and Quests | Locks prompts for SOL when the wallet is low on fees. Quests offers a funding shortcut for newcomers. |

The links open **Fund from any chain** with SOL or USDC selected. Choose a source chain, enter a refund address, review the quote and deposit instructions, and track the transfer. The [Fund page](https://dev.solve3.fi/fund) is also available from the menu and through Just Ask.

For a mirror, set `NEXT_PUBLIC_INTENTS_ENABLED=true` at build time (or pass it as a Docker build arg) and supply `AURORA_INTENTS_API_KEY` only to the server. A devUSDC shortfall can show the nudge. The funding flow delivers **real SOL or USDC on Solana mainnet**, so use mainnet balances to complete a funded action.

### Smoke check

- Open Swap, add liquidity, and open the position from Wallet. Use a test wallet and check confirmations.
- Open Arena, lock test SOLV3, and vote. Open `/quests?tab=clans`, pick rally pools as a Clan leader, then return to Arena to check the rally strip and split vote.
- Open Just Ask from the header. Check `/partner/demo` for the sample partner workspace and `/beta/alm` for the preview.
- Run `bun run test:quest` and `bun run test:quest:voting` from `frontend/`. For the service integration check, apply the schema on a disposable PostgreSQL database and run `CLANS_TEST_DB_URL="$QUEST_OWNER_DB_URL" node scripts/quest/test-clans-service.mjs` with that disposable owner connection. The test uses fixture identities and rolls back its writes.

## Contracts and source revisions

| Path | Source and purpose |
| --- | --- |
| [frontend/](frontend/) | Dev frontend and Quest backend aligned to the November 8 Clan redesign at private snapshot `ad09a14c`. SDK build outputs are generated from the included sources. |
| [contracts/](contracts/) | Solve3 Anchor workspace at `d55804d4da512617209df6b4aa1366a436e936b6`. Voter rewards from epoch N are claimable in N+1. |
| [swap-contracts/](swap-contracts/) | Standalone Swap workspace at [98fb091](https://github.com/solve3fi/contracts/commit/98fb091c08a0bfe18dbdda133c69714daede2b56). Build it separately. |

Use the Rust version pinned in each workspace's `rust-toolchain.toml` and the corresponding Anchor/Solana toolchain. See [contracts/Anchor.toml](contracts/Anchor.toml) and the [standalone Swap build notes](swap-contracts/docs/VERIFIED_BUILD.md) before building. The standalone workspace's provider defaults to devnet. The frontend guide uses existing deployments and requires no program deployment.

| Devnet program | Address |
| --- | --- |
| `solve` (DEX) | `HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK` |
| `vesolve` (vote escrow) | `HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN` |
| `token` | `CKRSmDf3n1ZsAc91YyRyCwWLoNShZ4xi2nWESMbDw7Pw` |

The public mirror contains source and configuration instructions. Reproducing the hosted environment also requires its service credentials, operator keys, on-chain state and PostgreSQL data. Use your own isolated database and credentials. Private demo traffic scripts and generated build artifacts are outside the public snapshot.
