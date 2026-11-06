# Solve3 Full Launch v1 — Threat Model

**Workstream:** Claude WS4 (handoff Part J, task J1). **Status:** DRAFT; feeds Codex J2 (reproducers and minimal fixes).
**Method:** desk review of `programs/vesolve`, `programs/solve`, `programs/token` at `7a465d3`. **Nothing here was executed.** "Observed" means I read the source; "Unverified" means I could not confirm and Codex must. Severity is my estimate of impact under the *frozen* rules, before mitigations: CRITICAL (loss of funds / unbounded mint), HIGH (reward theft, bypass of a frozen invariant), MEDIUM (griefing, bounded loss), LOW.

Principles carried from the handoff: assume users call programs directly (M4); frontend checks are not controls (M3); fail closed; earned amounts immutable (M13).

---

## 1. Assets and trust boundaries

| Asset | Where | Who can move it |
|---|---|---|
| SOLV3 mint authority | `Protocol` PDA | only vesolve CPIs |
| Pool reward vaults, bribe vaults, fee vaults | PDAs | program, by claim rules |
| Exit fee SOL | `Protocol` PDA lamports | `withdraw_exit_fees` (Admin) |
| Program upgrade authority | BPF loader | Admin (F3) |
| Admin authority | compiled-in `ADMINS` array (`auth/admin.rs`) | those keys |

Actors: LP, voter, bribe depositor, Admin, keeper (public Auto-Vote keeper key, compiled in), arbitrary program caller.

## 2. Threat catalog (J1 list)

Format: threat · attack · surface in current code · existing guard · severity · test reproducer for Codex J2 · minimal fix direction.

### 2.1 Economic manipulation

**T1 Wash trading.** Attack: self-trade to farm fee-based weight or open the gate. Surface: gate input is pool fee growth. Guard: weight is not fee-scaled (A/B/C design); gate is a pool-wide switch. Residual: attacker pays fees (to voters) to open the gate. MEDIUM (bounded: cost `168·φ·V` per week, see PLW §5.3). Test: simulate hourly wash at φ with and without attacker owning votes; assert earned ≤ budget and attacker net of fees. Fix: none beyond φ calibration; voter-attacker recoup is accepted by design only if Seth accepts (Gate 7).

**T2 Flash liquidity / rapid add-remove.** Attack: add huge liquidity for one block. Guard: time-integrated weight, DEX checkpoints before liquidity changes. Observed in sim: 100× capital for one minute earns 0.01% of a week. LOW. Test: I10 flash scenario on Devnet with bank-time control. Fix: none.

**T3 Range/tick manipulation, micro-range.** (2026-10-01: the spacing-64 floor was removed by decision so stable pairs can be gauged; this threat is open for low tiers and rests on the activity gate.) Attack: 1-tick position holds enormous `L` per dollar and re-centres. Sim: $1k captured 50.9% vs $100k at ±5% without a floor; 9.2% with spacing 64. Surface: any `open_position*` / `reset_position_range` in a gauge pool. Guard: **none currently** (no width floor). HIGH until the approved floor ships. Test: open positions at width 1 spacing in a canonical pool, assert rejected; assert weights proportional. Fix: approved D2 floor, enforced at the program (not frontend).

**T4 Repeated tick crossing.** Attack: oscillate price across a tick to force checkpoint/compute use or to shift weight. Guard: checkpoint before crossing (`solve_manager.rs`); swaps pay fees. Residual: compute-unit pressure on large crossings. MEDIUM. Test: swap across 100+ initialised ticks; assert accounting identical to per-tick sum and within CU budget. Fix: Codex C2 compute estimate.

**T5 Sybil splitting.** Attack: many positions/wallets to extract rounding or exceed per-wallet limits. Sim: floors always favour the vault; 500-way split loses dust. Weight is additive in `L`. LOW. Test: 500 positions vs 1, assert `Σ paid ≤ budget` and equal share ±dust. Fix: none.

**T6 Rounding extraction.** Attack: checkpoint spam to bias rounding. Observed: `checked_mul_div(...).unwrap_or(0)` and `>> 64` floors; frequent checkpoints only lose dust to the vault. Residual: overflow in `checked_mul_div` is swallowed to 0, silently halting accrual for that interval (stream tokens remain in vault) (Model F3). MEDIUM (loss of earned emission, not theft). Test: force overflow with extreme `rate/liquidity`; assert instruction fails or accrual preserved. Fix: error instead of `unwrap_or(0)`.

**T7 Over-mint / emission drift.** Surface: `weekly_emission` fixed-point power. Verified offline: exceeds the frozen recurrence by a few base units from epoch 11 (1,712 of 5,001 epochs). Also `fund_native_gauge` mints the full gauge budget up front (Model F1) and a 4% developer allocation is carved out (F2). HIGH (violates B1–B4 minting rules even though magnitudes are small for the drift). Test: reference-model comparison over 5,000 epochs; I9 supply reconciliation. Fix: implement the recurrence; mint-on-claim/burn-unearned per OPEN-6; remove or ratify developer split (OPEN-5).

### 2.2 Voting and positions

**T8 Double voting.** Attack: use one wallet's two locks, or the same power through `UserVote` replace logic. Surface: `UserVote` keyed `(wallet, epoch)`, `VoteLockRecord` records only the **last** lock that voted. Guard: partial (replace logic subtracts the previous allocation). Residual: per-wallet, not per-position, accounting (INV-V1). Auto-vote keeper path adds a second signer class. HIGH until position-keyed. Test: model-based random interleaving of votes across 2–5 locks and 3 wallets; assert `Σ epoch weights = Σ position allocations ≤ power`. Fix: `(ve_token_id, epoch)`-keyed vote record (Invariants §3.1).

**T9 Vote laundering by transfer.** Attack: vote, transfer, recipient resets/revotes/exits. Observed: transfer of a voted lock is **rejected** (`transfer_lock.rs:73`), so the A8 scenario cannot occur today; the handoff requires it to be *allowed* with state bound to the position. The moment transfer is enabled, T9 becomes HIGH unless the binding ships with it. Test: all of I6 as adversarial cases. Fix: ship the transfer relaxation and `original_epoch_voter` binding in one change.

**T10 Split/merge laundering.** Observed: split propagates `last_vote_epoch` to the child (`split_lock.rs:159`) and rejects splitting a voted lock; merge propagates `max(last_vote_epoch)` rather than rejecting (INV-V6). Safe but diverges from A9. LOW. Test: split-then-exit and merge-then-exit in the same epoch as a vote. Fix: reject merge when either voted (spec §5.4).

**T11 Epoch/cutoff race.** Attack: vote at the boundary, or exploit a late `update_epoch` crank. Observed: `voting_is_open` uses `epoch.end_time − 1h`, not 23:55 (F5); `vote` also requires `protocol.current_epoch == epoch.epoch`, so a stale crank leaves the old epoch voteable only until `end_time − 1h`. Bribe path: `create_bribe` takes `epoch` as a plain `mut` account with **no seeds, current-epoch or cutoff constraint** (observed, `create_bribe.rs:16-20`): bribes can be deposited into any Epoch account including past ones, and after cutoff. HIGH for the bribe path (funds stranded or frontrun). Test: bribe after cutoff and into epoch N−1. Fix: seed-pin the epoch to `protocol.current_epoch` and enforce cutoff.

### 2.3 Bribes and reward tokens

**T12 Bribe spam / malicious SPL tokens.** Observed: `create_bribe` accepts any mint (`token_interface::Mint`), no whitelist (INV-B1), per-gauge cap of 20 bribe tokens, `init_if_needed` on `bribe` and vault accounts. Attacks: (a) fill the 20 slots of a gauge with junk tokens so a real bribe is rejected (`MaxBribesPerGaugeReached`); (b) Token-2022 mints with transfer fees/hooks/freeze/permanent delegate: the recorded `amount` is not what the vault receives, so claims can exceed the vault (insolvency) or revert forever (a frozen vault blocks all claims in a shared claim path); (c) rent-drain via many `init_if_needed` accounts (attacker pays; low). HIGH. Test: deposit a transfer-fee Token-2022 mint, then claim; assert claims are bounded by actual received. Fix: Admin whitelist (A12), reject extensions that break accounting, record the vault balance delta not the requested amount, per-token claim isolation (A12 per-token pause).

**T13 Reward-token failure.** Attack/event: mint frozen, token account closed, blocklisted recipient. Surface: claim handlers pay in one CPI; a failure reverts the whole claim. Guard: revert is atomic so `earned` is not lost, but there is no `FAILED_RETRYABLE` state or per-token isolation: one bad token can block a multi-asset claim. MEDIUM–HIGH. Test: I17 failure injection. Fix: per-asset claim instruction/accounting (Spec §10).

### 2.4 Gauges, pools, canonical

**T14 Gauge duplication / fake canonical pool.** Observed: `Gauge` PDA is keyed by pool; nothing prevents two pools of one pair from each getting a gauge (INV-G1). `configure_native_gauge` is Admin-only, so the exposure is Admin error or compromise, not anonymous. Also `create_gauge`/`configure_native_gauge` require the DEX config `fee_authority == admin` (a coupling to the DEX authority). HIGH under the "no simultaneous canonical gauges" rule (M10). Test: two pools same pair, activate both, assert second fails. Fix: `PairCanonical` PDA (Invariants §3.3).

**T15 Activation/removal timing.** Observed: activation and fee-rate flip are immediate (F4); removal requires swept fees but has no pending state. Attack: Admin (or compromised Admin) flips routing mid-epoch to capture or strand fees. MEDIUM. Fix: pending states per §4 of the spec.

**T16 Fee routing leak across transitions.** Observed: deactivation requires `protocol_fee_owed == 0` (good, `GaugeFeesMustBeSwept`); activation has no equivalent check that pre-activation fees were settled at 95/5. MEDIUM (violates M7). Test: accrue fees, activate, assert pre-activation fees keep 95/5. Fix: sweep before activation.

### 2.5 Exit and oracle

**T17 Oracle manipulation.** Observed: Exit price is an **Admin-published constant** (`ExitConfig.lamports_per_solv3`, `set_exit_price`), live from day 0; the 4-week disable (D2) is not implemented. Attacks: Admin (or key thief) sets the price to ~0 and every holder exits at near-zero SOL fee, converting locked supply to circulating; or sets it high to grief. CRITICAL under the frozen "Exit disabled through Week 4" rule while the instruction is live. Test: call `exit_lock` on Devnet genesis state; assert reject until week 4. Fix: hard-disable until a Week-4 timestamp enforced on-chain; later TWAP architecture per D4.

**T18 Exit fee base / rounding.** `fee = amount·price·4000/1e9/10000` with successive floors; tiny exits can round the fee to 0 (the code skips the transfer when `fee_lamports == 0`). Attack: repeated micro-exits at zero fee once partial Exit exists. MEDIUM. Test: partial exits of 1…10⁶ base units. Fix: minimum exit size or ceiling rounding on the fee.

### 2.6 Admin, upgrade, pause

**T19 Admin compromise.** Observed: `ADMINS` is a compiled-in 2-key array, no transfer path, no multisig, no timelock on parameter changes (e.g. `set_exit_price`). CRITICAL if a key leaks, given T17. Fix: transferable Admin authority account (F1), timelocked/next-epoch parameter changes, pause bypass for the owner of emergency controls only.

**T20 Upgrade / timelock bypass.** Observed: no timelock account in the programs; upgradeability follows the BPF loader authority. Unverified: who holds the loader authority on Devnet/Mainnet. HIGH until verified. Test: attempt immediate upgrade with the authority; assert 24h gate (I15). Fix: timelock program or on-chain schedule as F3 specifies.

**T21 Pause bypass.** Observed: no pause flags exist in vesolve or solve (only per-stake `is_paused`). So F2 is MISSING; any instruction can be called in any incident. HIGH operationally. Test: I14 matrix once implemented.

### 2.7 Account and CPI safety

**T22 Account substitution.** Observed guards: many instructions bind PDAs by seeds and `has_one` (good: `native_gauge.rs` ConfigureNativeGauge, `claim_pool_reward` mint/owner constraints). Gaps seen: `create_bribe` (`epoch`, `gauge` unconstrained), and `fund_native_gauge` accepts `caller` permissionlessly (intended). Unverified for the rest: Codex J2 should audit every `#[derive(Accounts)]` for missing seeds/has_one/owner. MEDIUM.

**T23 CPI abuse.** Observed: DEX `set_gauge_emissions` requires `authority == protocol PDA` derived against a hard-coded vesolve program id (`3D7d…RmNk`); `set_protocol_fee_rate` is called with the Admin as fee authority. Risks: hard-coded program id is correct only for that deployment (a redeploy to a new id silently breaks the check or locks gauges); DEX trusts one program. MEDIUM. Test: call `set_gauge_emissions` from a non-vesolve program; assert fail.

**T24 Overflow/underflow.** Observed: widespread `checked_*`; `wrapping_add/sub` only in growth accumulators (intended, Whirlpool convention). `Epoch.gauge_weights` is a bounded Vec (100 entries; earlier version exceeded the 10,240 byte account limit per the code comment). LOW–MEDIUM. Test: property tests at u64/u128 extremes.

**T25 Stale-account / replay.** Observed: claims use per-epoch claim markers/`AlreadyClaimed`; fee sweep pins `expected_epoch` and requires exact balance deltas (good). Unverified: claim replay across closed/re-created PDAs (relist with the same PDA, T14/INV-G4). MEDIUM. Test: claim, close, re-open, claim again (I2/I17).

**T26 Duplicate claims.** See T25. Per-claim indices exist (`claim_*`). Test: replay and concurrent claim transactions in one slot.

### 2.8 Presale / genesis (not in J1, noted)

Presale claims have no deadline and mint permanently locked veSOLV3: replay/double-claim protection must be tested (I2). No code reviewed here for presale (not in this repo): Unverified.

## 3. Severity summary

| Sev | Items |
|---|---|
| CRITICAL | T17 Exit live with Admin price, T19 Admin compromise surface |
| HIGH | T3 micro-range, T7 emission drift/up-front mint, T8 per-wallet votes, T9 (on enabling transfer), T11 bribe path, T12 bribe tokens, T14 canonical uniqueness, T20 upgrade authority, T21 no pauses |
| MEDIUM | T1, T4, T6, T10, T13, T15, T16, T18, T22, T23, T25 |
| LOW | T2, T5, T24 |

Gate 7 requires no unresolved CRITICAL/HIGH; each row above that stays open must be fixed or carry explicit accepted residual risk.

## 4. Recommended fix order (for Codex Workstream 4 "safe independent fixes")

1. T17 hard-disable `exit_lock` until a Week-4 on-chain timestamp (tiny, independent of oracle design).
2. T11/T12 bribe path: pin epoch, enforce cutoff, require active gauge, whitelist, record received amount.
3. T21/T19/T20 pause flags, transferable Admin, upgrade-schedule account.
4. T8/T9 position-keyed votes plus transfer relaxation together.
5. T14/T15/T16 `PairCanonical`, pending gauge states, sweep-before-activation.
6. T7 emission recurrence and mint-on-claim (needs OPEN-5/OPEN-6 decisions).
7. T3 width floor and the activity gate (blocked on Gate 3).

## 5. What I could not assess

- Presale/claim program, frontend, SDK, off-chain keeper (auto-vote keeper key is compiled in; its operational security is out of scope).
- Deployed upgrade-authority and mint-authority holders (needs chain queries).
- Token-2022 behaviour of `transfer_token_to_vault` beyond `TransferChecked` (extension handling unread).
- Compute-unit costs (no runs).
