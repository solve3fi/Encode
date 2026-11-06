# Devnet rehearsal runbook (fast epochs)

Seth signs every on-chain step with keys only they hold. Nothing here touches mainnet. The sandbox cannot reach Devnet, so this is run from Seth's machine.

## 0. Build

```
cargo build-sbf --manifest-path programs/vesolve/Cargo.toml --features fast-epochs --sbf-out-dir target/deploy-fast
cargo build-sbf --manifest-path programs/solve/Cargo.toml   --features fast-epochs --sbf-out-dir target/deploy-fast
cargo build-sbf --manifest-path programs/token/Cargo.toml   --sbf-out-dir target/deploy-fast
```

`fast-epochs` gives 20 minute epochs, a 20 second vote cutoff and ~7 second gate buckets. CI proves the release `vesolve.so` does not contain that code, and `initialize` logs `fast-epochs test build` when it does. Never deploy a fast build to mainnet.

## 1. Deploy with fresh program IDs

New keypairs for each program (Seth keeps them), `declare_id!` updated to match for the rehearsal, deployed with the Devnet deployer key.

> **Order matters.** Do section 3 (genesis) and section 4 (configure) *before* this handover. `token.initialize_mint` requires its signer to be both an admin key and the token program's current upgrade authority, so after the handover nobody can call it. Deploy with the Admin key as upgrade authority, run genesis, then hand over. Also: changing the `vesolve` program ID requires updating the hardcoded vesolve ID in `programs/solve/src/instructions/set_gauge_emissions.rs` (the gauge-reward authority PDA), otherwise `configure_native_gauge`/funding fail with `InvalidGaugeRewardAuthority`.

## 2. Hand the upgrade authority to the timelock (after sections 3 and 4)

For each program, set its upgrade authority to the vesolve PDA `[b"upgrade_authority"]` (derive it with `PublicKey.findProgramAddressSync([Buffer.from("upgrade_authority")], VESOLVE)`):

```
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <TIMELOCK_PDA> --skip-new-upgrade-authority-signer-check
```

From here an upgrade is: write a buffer, `solana program set-buffer-authority <BUFFER> --new-buffer-authority <TIMELOCK_PDA>`, `schedule_upgrade`, wait 24 hours, `execute_upgrade`. `cancel_upgrade` stops it.

## 3. SOLV3 genesis and mint authority

1. `token.initialize_mint` (decimals 9), mint exactly 100,000,000 SOLV3 with `mint_tokens` (it refuses more than that over the mint's lifetime).
2. `vesolve.initialize` (Admin wallet signs; epoch length argument is the build's `WEEK`: 1200 for the fast build).
3. `token.transfer_mint_authority` to the vesolve Protocol PDA, so only vesolve emissions can mint from here.

## 4. Configure and verify

`set_treasury`, `set_exit_price` if Exit will be tested (it stays closed until epoch 4), whitelist bribe tokens, create gauges and schedule activation (`schedule_gauge_activation`, then `configure_native_gauge(true)` after the next epoch starts).

Then run the read-only check and keep its output as evidence:

```
RPC=https://api.devnet.solana.com VESOLVE=... SOLVE=... TOKEN=... SOLV3_MINT=... ADMIN=... TREASURY=... node scripts/devnet/readback.mjs
```

## 5. Operational duties each epoch

- Anyone: `update_epoch` after the boundary.
- Keeper: after the rollover, switch on every gauge whose scheduled activation is due (`configure_native_gauge(true)`), settling the pool's owed fees first in the same transaction (Treasury sweep at the removed-gauge rate, DEX collect + forward at any other rate). One gauge failing does not stop the others or the epoch's emission work; the run fails at the end so the failure is visible. Verified on the rehearsal-3 Devnet with one gauge per settlement path.
- Admin: `configure_native_gauge` for scheduled removals once their epoch arrives (the keeper only announces them: completing a removal moves voter fees); vote protocol allocation locks (`vote` signed by Admin on registered locks) before the cutoff.
- Keeper: route a gauge's accrued fees (`route_pool_fees`) only when that gauge has voting power in the current epoch (DEV-10). Fees routed into an epoch without votes cannot be claimed and the program has no recovery instruction; the keeper skips such gauges and the fees roll into a later epoch.
- Reactivating a removed gauge: the program refuses `configure_native_gauge(true)` while the pool has owed protocol fees. Settle them in the same transaction: at 500 bps `sweep_ungauged_pool_fees`; at any other rate (the keeper resets removed gauges to 0 bps) a DEX `collect_protocol_fees` by the collect authority, forwarded to the Treasury (DEV-11). The Admin "Switch on" button does this.
- Upgrade timelock: `cancel_upgrade` removes the schedule but leaves the buffer (and its rent) with the timelock PDA (DEV-13); re-use the buffer in a later schedule instead of writing a new one.
- Adding a gauge: only one pool per token pair can hold a gauge (DEV-14); the Admin page disables the other fee tiers of that pair until the holder is removed.

## 6. Local build and test notes (WSL)

- Build and test commands that worked on Windows + WSL (the Solana toolchain lives in WSL): `CARGO_TARGET_DIR=~/.cache/<dir> cargo build-sbf --manifest-path programs/<p>/Cargo.toml [--features fast-epochs] --sbf-out-dir deploy-out/<name>` (a root-owned `target/` from an earlier Docker build otherwise blocks writes). `cargo build-sbf` also writes a stray `<program>-keypair.json` into the out dir: delete it, it is not your program keypair.
- Run the SVM suite against a chosen build with `cd tests/svm && SBF_OUT_DIR=<abs path to default build> cargo test`.
- The Anchor TS client fills accounts that have a fixed `address` in the IDL (such as `solve_program`) with the IDL's old ID, so pass them explicitly.
- Devnet's public RPC rate-limits heavily; use a private Devnet RPC for the scenario scripts.
- Votes do not roll over: recast every epoch. Voting rewards unlock one epoch after the vote (when the next epoch begins). The Solana CLI defaults to mainnet: always pass `--url devnet`.
