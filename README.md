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

## Provenance

- **Contracts:** branch `feat/partner-voter-fee` at commit `d55804d` (2026-10-13) of the Solve3 `ve33-contracts` repository, tracked files only.
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
- **Frontend:** Node and bun. Run `bun install`, then `npm run dev` (development) or `npm run build` (production). RPC endpoints
  and API keys are read from environment variables that are not included here (for example `SOLVE3_DEVNET_RPC_URL`);
  without them the app falls back to the public devnet RPC.

## Not included

Environment files, deployment keypairs, server configuration secrets and RPC API keys. Two files that contained
RPC keys (`contracts/audit/SECURITY_AUDIT_2026-07-13.md` and `frontend/scripts/verify-emissions-redesign.mjs`) show `REDACTED` in their place.
