# Existing Test Coverage (Handoff Part K, Codex Workstream 2)

**Authored by:** Claude, standing in for Codex at Seth's request (2026-10-01). Desk inventory; **no test was executed** (no Rust/Solana/Anchor toolchain run, no Devnet access: the sandbox network policy blocks `api.devnet.solana.com`).
**Basis:** `ve33-contracts` main (after PR #13 content) and `frontend` main `48147eb`. Invariant IDs refer to `SOLVE3_FULL_LAUNCH_INVARIANTS.md`; rows refer to `CODEBASE_REQUIREMENTS_MATRIX.md`.

## 1. What exists

| Layer | Location | Count / content | Runs in CI? |
|---|---|---|---|
| Rust unit tests (pure logic) | `programs/**/src` `#[test]` | **35** tests: `vesolve` 28, `solve` 7 | **No.** The only workflow `contract-build.yml` builds `vesolve`; it triggers on branch `codex/permanent-vesolv3-locks` and manual dispatch, and (as read) does not run `cargo test` |
| Anchor TS integration tests | `tests/` | `token/solve-token.ts` (5 cases: init mint, mint to admin, mint to Bob, "Bob cannot mint", transfer); `solve/00,02,03` (init DEX config, config extension, fee tiers); `solve.ts` (commented out). **No `vesolve` integration tests** | No |
| Frontend node tests | `frontend:tests/*.test.mjs`, `scripts/test-*.mjs` | Genesis indexer/quest/airdrop/token-list/UI helpers, `test-gauge-fee-policy.mjs`, `test-create-gauge-fees.mjs`, `test-epoch-fee-routing.mjs`, `test-native-gauge-local.mjs`, `test-native-gauge-funding-local.mjs` (loopback validator only), `test-lp-incentive-accrual.mjs` | `package.json` has `test:lp-incentives` and `test:quest` scripts; no GitHub workflow exists in the frontend repo |
| One-off Devnet proofs | `frontend:scripts/verify-*.mjs` | `verify-bribe-fix`, `verify-vote-lock-fix`, `verify-vote-reward-claim`, `verify-emissions-redesign`, `verify-public-auto-vote`, `verify-pool-fee-vault`: ad-hoc, "not meant to be permanent" (per their own headers), run by hand against Devnet | No |
| Audit | `audit/SECURITY_AUDIT_2026-07-13.md` | prior review (not reread here) | – |

## 2. The 35 Rust tests mapped

| Test | Covers |
|---|---|
| `emissions_follow_published_compounded_decay` | B2, but only epochs 0–2. **It cannot see the drift from epoch 11** (INV-S3) |
| `developer_allocation_is_four_percent_of_weekly_total`, `final_vote_weight_assigns_gauge_budget` | B3 under the current 4% split; the second test asserts a 6,800/20,000 vote share on 96% of epoch 1 (consistent with **[D]** carve-out; will need re-basing if the schedule changes) |
| `stream_stops_and_conserves_budget`, `rate_rounding_never_spends_more_than_allocated` | stream never over-spends; A6 floors |
| `weight_earns_pro_rata_of_the_reward_stream`, `start_period_carries_forward…`, `start_period_ignores_remainder…`, `sync_*` (5), `isqrt_matches_known_values` | **legacy fee-weighted `GaugeStake` accrual**, the design the PLW model rejected (D). Tests assert carry-forward behaviour that B5 forbids for the native gauge |
| `fund_*`, `sync_*` (pool_fee_vault) | pool fee vault weight accounting (legacy fee-share path) |
| `repeated_sweeps_accumulate_exactly`, `collection_requires_exact_balance_delta_and_zeroed_counters`, `instruction_pins_epoch_and_has_no_off_chain_amount_arguments` | fee sweep exactness (INV-F4/F5 partly) |
| `pause_survives_missed_rollover_and_activation_rejects_unsupported_mints` | gauge activation guard for classic SPL pools; **not** a pause feature (name is about deactivation) |
| `voting_closes_exactly_one_hour_before_epoch_end`, `voting_cutoff_check_handles_timestamp_overflow` | cutoff; **asserts the 1-hour cutoff that contradicts A5 (23:55)**; must change with the rule |
| `voting_rewards_unlock_when_the_next_epoch_begins`, `voting_rewards_epoch_overflow_is_not_claimable` | N+1 reward hold (changed from N+2 per Seth, 2026-10-13, OPEN-2) |
| `voting_power_is_one_to_one…`, `permanent_lock_never_expires`, `split_rejects_zero_and_full_amount` | D1 lock arithmetic |
| `accepts_both_position_token_programs…`, `exact_legacy_layout_preserves_claims_and_identity` | legacy-stake migration |
| `active_gauge_routes_all_fees_without_lp_fee_growth` (`solve`) | A2 active-gauge 100% to protocol/voters at the DEX level |
| `weekly_budget_is_liquidity_weighted_even_with_zero_lp_fees`, `tick_exit_and_reentry_exclude_out_of_range_time`, `deactivation_preserves_earned_growth_and_stops_new_rewards`, `no_liquidity_does_not_create_future_backpay`, `enabling_requires_unused_reward_and_migrated_extension` | **Candidate A accumulator** behaviours: in-range-only, no back-pay, prospective join, deactivation preserves earned (B4, B5, INV-S8/S9) |

## 3. Coverage against invariants and rules

| Area | Covered by existing tests | Not covered (needs tests) |
|---|---|---|
| Emission schedule | epochs 0–2 | recurrence reference over 5,000 epochs; supply reconciliation; mint-on-claim/burn; dev + gauges ≤ E (INV-S1–S5) |
| Native gauge accumulator | in-range, tick crossing, no back-pay, deactivation, rounding floor | micro-range, flash, wash, 500-way split, overflow→0 swallow (T6), range floor, activity gate, first-hour carry (C **[D]**) |
| Fee routing | active-gauge routing, sweep exactness | 95/5 states, transitions with accrued fees, pre-activation fees keep routing, exactness of splits (INV-F2/F4/F5/F6) |
| Gauge lifecycle | activation guard | pending activation, removal, relist, canonical uniqueness, migration (A3, A4, INV-G1–G5) |
| Voting | cutoff arithmetic | double voting across locks, per-position state, reset, revote by non-voter, transfer-while-voted, merge prohibition, rollover clear (INV-V1–V6, I5–I6) |
| Exit | none | disabled-through-Week-4, partial, voted rejection, fee rounding, stale oracle (D2–D6, I16) |
| Bribes | none | whitelist, cutoff, epoch pinning, Token-2022 fee mints, zero-vote → Treasury, per-token pause (A12, I8) |
| Accounting | none beyond sweep/rounding | `earned = claimed + outstanding`, failure injection, retry across lifecycle (E, I17) |
| Admin / pause / upgrade | none (features absent) | all of F; admin transfer; timelock (I14, I15) |
| Token program | admin mints, non-admin cannot (`solve-token.ts`) | the **absence** of a mint cap is encoded as expected behaviour; no test that total supply is bounded (B1) |
| Presale/claims | none in these repos | I2 |
| Account-substitution / CPI | none | T22/T23 reproducers |

## 4. Quality notes

1. **Almost nothing runs automatically.** No CI job executes the 35 Rust tests or any TS test; the single workflow builds one program on a codex branch. Gate 4 ("all affected invariants have automated coverage") cannot be met without a test workflow.
2. **No on-chain `vesolve` integration tests exist.** Every vote, transfer, split, claim, bribe and exit rule is exercised (if at all) by ad-hoc Devnet scripts whose results are not retained as regression tests.
3. **Some tests lock in behaviour that now contradicts the frozen rules** (1-hour cutoff; legacy carry-forward). They must be changed together with the code, not left to fail.
4. **`tests/solve.ts` is commented out** and the TS suites assume a local validator with `upgradeable = false` genesis programs (Anchor.toml); they were not run.
5. **The frontend loopback tests (`test-native-gauge-*local.mjs`) are the closest thing to integration coverage** of the native gauge and are worth promoting into the Devnet harness (Workstream 3).

## 5. Recommended minimum test additions (feeds Gate 4 and the Devnet harness)

1. Add a CI workflow running `cargo test` for all three programs and the frontend `node --test` suites on every PR.
2. Property tests (Rust): emission recurrence vs reference (5,000 epochs); accumulator split/rounding; random vote/transfer/split/merge/exit sequences with an invariant checker.
3. LiteSVM/solana-program-test integration suite for `vesolve` (time-warp via clock override) covering I3–I8, I11–I17 negative cases first (attacks must fail).
4. Convert the useful `verify-*.mjs` Devnet proofs into retained, parameterised scripts that write evidence JSON (balances, events, tx signatures).
5. Replace the cutoff and legacy-carry tests when A5 and B4/B5 land.
