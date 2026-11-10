# Encode: Solve3 source snapshot

A read-only copy of the Solve3 smart contracts and frontend, prepared for review. It is a snapshot with no
git history from the working repositories. Secrets and deployment keys have been removed.

## What is Solve3

Solve3 is a community-directed liquidity protocol on Solana. Holders lock SOLV3 for voting power and vote each week to
direct SOLV3 emissions to concentrated-liquidity pools. Liquidity providers earn those emissions; voters earn the
trading fees and partner incentives of the pools they back.

## Layout

| Folder | Contents |
| --- | --- |
| `contracts/` | Anchor workspace with three programs: `solve` (concentrated-liquidity DEX), `vesolve` (vote-escrow locks, gauges, voting, rewards) and `token`. Also tests, scripts, docs and the security audit notes. |
| `frontend/` | Next.js app: Epoch Arena, swap, liquidity, locks and voting, quests and Pass, partner portal and accelerator, Just Ask command bar, Aurora Intents funding, and the private ALM and Yield Hunter preview pages. Includes the SDK packages it uses (`frontend/packages`). |
| `frontend/deploy/quest-backend/` and `frontend/db/quest/` | Devnet quest backend, worker scripts, database migrations and database tests. |

## Provenance

- **Contracts:** commit `d55804d4da512617209df6b4aa1366a436e936b6` (2026-10-13) of the Solve3 `ve33-contracts` repository. This revision makes voter rewards from epoch N claimable in epoch N+1.
- **Frontend:** the source behind the dev site (https://dev.solve3.fi), taken 2026-11-06.

## Devnet deployment

The frontend is configured for these Solana devnet program IDs (also in `contracts/Anchor.toml`):

| Program | Address |
| --- | --- |
| `solve` (DEX) | `HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK` |
| `vesolve` (vote escrow) | `HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN` |
| `token` | `CKRSmDf3n1ZsAc91YyRyCwWLoNShZ4xi2nWESMbDw7Pw` |

Tokens on devnet have no monetary value.

## Building

- **Contracts:** Rust 1.89.0 (`contracts/rust-toolchain.toml`) and the Anchor toolchain. See `contracts/Anchor.toml` and `contracts/docs`.
- **Frontend:** Install Node and Bun, then build the local SDK packages before starting Next.js:

  ```sh
  cd frontend
  bun install --frozen-lockfile --ignore-scripts
  bun run --cwd packages/common build
  bun run --cwd packages/sdk build
  bun run --cwd packages/solve3 build
  NEXT_PUBLIC_CLUSTER=devnet bun run dev
  ```

  Use `NEXT_PUBLIC_CLUSTER=devnet bun run build` to make a devnet build. The app uses the public devnet RPC by default. Private
  RPC and service credentials are configured through environment variables.

## Not included

Environment files, deployment keypairs, server configuration secrets and RPC API keys. Two files that contained
RPC keys (`contracts/audit/SECURITY_AUDIT_2026-07-13.md` and `frontend/scripts/verify-emissions-redesign.mjs`) show `REDACTED` in their place.
