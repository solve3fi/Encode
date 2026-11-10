# Solve3 DEX program

The on-chain DEX program for [Solve3](https://solve3.fi), a vote-escrow (ve(3,3)) exchange on Solana.

> **This is a fork of [Orca Whirlpools](https://github.com/orca-so/whirlpools), under the Apache License 2.0.**
> It is derived from the Orca Whirlpools program **as it was published under Apache 2.0, up to and including
> 26 February 2025** (repository commit [`e528dd23`](https://github.com/orca-so/whirlpools/commit/e528dd23bb41571f92cfdb49a2f15d4fa0b01bec),
> program v0.3.4, last program change `7f0ca73f`). It contains **no Orca code committed on or after 27 February 2025**,
> when Orca moved the repository to its own, more restrictive "Orca License".
> See [`docs/PROVENANCE.md`](docs/PROVENANCE.md) for how this was established and checked, and [`NOTICE`](NOTICE)
> for attribution and a summary of our modifications.

Solve3 is not affiliated with or endorsed by Orca. "Orca" and "Whirlpool" are trademarks of their owners.

## What this program is

A concentrated-liquidity AMM (a Whirlpool-style CLMM): liquidity providers choose price ranges, pools have fee
tiers and tick spacing, positions are NFTs, and rewards can be emitted to in-range liquidity. The core maths, tick
arrays, swap engine, position bundles, Token-2022 support and two-hop swaps are Orca's, unchanged apart from renaming
(`Whirlpool` becomes `Solve`) and the toolchain port described below.

## What Solve3 added

| Addition | Purpose |
|---|---|
| Gauge emissions (`set_gauge_emissions`, `burn_unearned_gauge_emissions`) | The Solve3 governance program (`vesolve`) funds a pool's reward slot with SOLV3 emissions chosen by veSOLV3 votes. Only the governance PDA may manage a gauge reward. |
| Activity gate (`state/gate.rs`) | A pool earns gauge emissions in an hour only if the previous hour showed enough fee yield. It is a pool-wide switch; it never scales an individual position. State lives in 32 bytes of the pool account. |
| Trading pauses (`set_trading_pauses`) | Admin switches that stop swaps and new liquidity independently. Removing liquidity, collecting fees and closing positions are never paused. |
| Default protocol-fee cap | The default protocol fee rate for new pools is capped at 8,000 of 10,000 basis points. |
| Branding and metadata | SOLV3 position NFT names, symbols and metadata URIs, memo text and `security.txt`. |
| `fast-epochs` build feature | Test-only build with shortened time buckets for devnet rehearsals. |
| Toolchain port | Anchor 0.32.1, Solana crates 2.x. |

## Relationship to the other Solve3 repositories

- The governance program (`vesolve`: vote-escrow locks, voting, bribes, native gauges, exit fee) and the SOLV3 token
  program live in the `ve33-contracts` repository. `vesolve` calls this program through Anchor CPI.
- The web app, indexer and quest backend are in the Solve3 frontend repository.

## Building

Requires the Rust toolchain pinned in `rust-toolchain.toml` and the Anchor CLI.

```sh
anchor build                             # default build
anchor build -- --features fast-epochs   # devnet rehearsal build
```

## TypeScript SDK

[solve3fi/sdk](https://github.com/solve3fi/sdk) is the Apache-2.0 TypeScript client for this program, derived from Orca's
last Apache-2.0 SDK. It adds the `solves_config` account to swaps and liquidity changes.

## Security

Contact: admin@solve3.fi. Please do not disclose vulnerabilities publicly before we have had a chance to fix them.

Orca's audits cover Orca's code. Solve3's modifications and additions have not been independently audited.

The ve(3,3) governance programs (SOLVE token, core ve(3,3) logic, veSOLVE) were assessed by LedgerOps in 2026; the
report is in [`docs/audits`](docs/audits/README.md). That assessment does not cover this swap program.

## Community

[solve3.fi](https://solve3.fi) · [X](https://x.com/solve3fi) · [Discord](https://discord.gg/ZDyXeyjGc7) · [GitHub](https://github.com/solve3fi)

## License

[Apache License 2.0](LICENSE). Portions are copyright 2022 Orca Foundation and used under that license; see
[`NOTICE`](NOTICE). Solve3's own additions are also released under Apache 2.0.
