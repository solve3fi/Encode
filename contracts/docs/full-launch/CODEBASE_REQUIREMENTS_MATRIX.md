# Codebase Requirements Matrix (Handoff Part H, task H1)

**Authored by:** Claude, standing in for the Codex workstream "Code Inventory" at Seth's request (2026-10-01). Codex or a second reviewer should cross-check before Gate 1.
**Basis:** desk review only. Nothing was built, run, simulated on-chain or read back from Devnet. Repos at: `ve33-contracts` main `db05adc` (programs `solve`, `vesolve`, `token`), `frontend` main `48147eb` (docs and `src`). `token-list` was not relevant to protocol rules.
**Classes:** IMPLEMENTED · PARTIAL · MISSING · CONTRADICTED (code does something the frozen rules forbid or differ from) · UNKNOWN (cannot be established from the repos; needs chain read-back or product docs).
**Risk:** C critical, H high, M medium, L low. **Order** = recommended implementation order (1 first). Decisions Seth approved on 2026-10-01 (Spec §8, §7.3–7.4) are applied; they are tagged **[D]**.
Paths are relative to `programs/` in `ve33-contracts` unless prefixed `frontend:`.

---

## A. Authoritative protocol rules

| Rule | Requirement (short) | Class | Where / what the code does | Required | Risk | Order |
|---|---|---|---|---|---|---|
| A1 | Soft Launch fees 50% LP / 50% Treasury | UNKNOWN | DEX has `protocol_fee_rate` per pool (`solve/state/solve.rs`) and a default in config; no 50/50 logic located. frontend:`docs/devnet-gauge-fee-policy-2026-09-14.md` shows Devnet **100% LP** for gaugeless pools | 50/50 during Soft Launch only | M | 9 |
| A2 | Full Launch: 95/5 unlisted & listed-ungauged; 0/0/100 when gauge active | CONTRADICTED | Devnet policy (frontend doc, applied 14 Sep): **no gauge = 100% LP / 0%**; **gauge exists (even inactive) = 20% LP / 80% protocol**. `vesolve/instructions/native_gauge.rs:112` sets `protocol_fee_rate` 10_000 on active and 0 on inactive. Rates are set by an **off-chain keeper script**, which the doc itself says is "not a contract-enforced invariant" | 95/5 (protocol_fee_rate = 500) until activation, then 10_000; routing keyed by **activation**, not gauge existence; enforced on-chain | H | 4 |
| A3 | Permissionless pool creation; listing approval; separate Admin gauge enable; activation at **next** epoch; UI pending state | PARTIAL | `schedule_gauge_activation` (Admin) sets PENDING_ACTIVATION effective next epoch; `configure_native_gauge(true)` runs the switch only once `current_epoch >= effective_epoch`; pending gauges take votes, not bribes. Tests: `vote_rules.rs`, `fee_routing.rs`. Open: on-chain listing registry (off-chain queue only); pool-creation gating UNKNOWN | on-chain listing registry | M | 5 |
| A3 | One canonical gauge-eligible pool per pair | DONE | `PairCanonical` PDA `[pair, lo, hi]` (sorted mints); `schedule_gauge_activation` refuses while another gauge holds the pair unless it is REMOVED; `schedule_gauge_migration` swaps old/new in one rollover. Tests in `vote_rules.rs` | none | - | 5 |
| A4 | Removal effective N+1; fees return 95/5; bribes stop; claims kept; stranded bribes → Treasury; fresh gauge on relist | PARTIAL | `request_gauge_removal` → PENDING_REMOVAL effective next epoch; bribes stop at request; `configure_native_gauge(false)` executes it (still requires fees routed). Relist reuses the Gauge account with `generation` + 1 (deviation from "fresh gauge": obligations stay keyed per epoch, so nothing is lost; flagged to Seth). Bribe sweep to Treasury exists | none beyond Seth's call on relist wording | L | 5 |
| A5 | Weekly epoch, Thu 00:00 UTC rollover; cutoff Wed 23:55 on chain time | PARTIAL | Rollover IMPLEMENTED (`vesolve/instructions/update_epoch.rs`, unix-week boundary). Cutoff CONTRADICTED: `VOTE_REVOCATION_DEADLINE` = 1 h (`vesolve/constants/ve.rs`, `vote.rs:8`); frontend shows "one-hour cutoff" (`frontend:src/components/EpochClock/index.tsx:29`). Bribe cutoff: none | cutoff 300 s before rollover for votes **and** bribes | H | 3 |
| A6 | Genesis epoch is normal voting; presale + allocations vote | UNKNOWN | `initialize` creates epoch 0 (`vesolve/instructions/initialize.rs`). Presale/allocation mechanics are not in these repos | verify on Devnet genesis run (I1/I2) | M | 9 |
| A7 | Split voting power; reset/change until cutoff; final state sets N+1 weights; no min threshold; zero-vote gauge: no emissions, fees/bribes → Treasury | PARTIAL | Votes: IMPLEMENTED (`vote.rs`, weights as percent summing check, `MAX_GAUGE_VOTES` 50). No explicit **reset** instruction (revote replaces). Zero-vote gauge: `fund_native_gauge` rejects (`InvalidGaugeVotes`/`InvalidAmount`), but **fees/bribes → Treasury routing is absent** | reset instruction; zero-vote → Treasury sweep | M | 6 |
| A8 | Vote state follows position+epoch; transfer allowed while voted; recipient cannot reset/revote/exit/split-launder | PARTIAL (stricter) | Votes and claims are now keyed per lock and epoch: `UserVote` `[USER_VOTE_SEED, lock, epoch]`, `VoteLockRecord` `[VOTE_LOCK_SEED, lock, epoch]`, claim records `[.., lock, epoch, ..]`; a wallet's locks all count (`vote_rules.rs`, `voters.rs`). `transfer_lock.rs:73` still **rejects** transfer of a voted lock (stricter than the rule) | decide whether to allow transfer while voted | L | 6 |
| A9 | Unvoted split/merge free; merge prohibited if either voted; voted cannot Exit; no split laundering | DONE | split rejects voted (`split_lock.rs:117`); merge now rejects if either lock voted this epoch (`merge_allowed`, unit-tested); `exit_lock.rs` blocks voted exit | none | - | 6 |
| A10 | Protocol allocations: own wallet, permanent lock, Admin-configured auto-vote per allocation, public | DONE (standing config + public crank) | `register_allocation_voter`, `set_allocation_votes`, `apply_allocation_vote`, Admin path in `vote`; tests in `vote_rules.rs` | none | M | 7 |
| A11 | Active gauge: voters get 100% fees proportional to vote weight | PARTIAL | `route_pool_fees.rs` + `distribute_pool_reward.rs` + `claim_pool_reward.rs` pay voters by vote share (IMPLEMENTED in principle); routing trigger is the keeper, and the 95/5 side is missing (A2) | see A2 | H | 4 |
| A12 | Bribes: whitelisted tokens only; deposit cutoff; no withdrawal; zero-vote → Treasury; delisted token blocks deposits keeps obligations; per-token pause | PARTIAL | `create_bribe.rs`: no whitelist, **epoch/gauge accounts unconstrained** (`:16-20`), no cutoff, any mint incl. Token-2022, per-gauge cap 20 tokens. No withdrawal path (good). `claim_bribe_reward.rs` claims at epoch end | whitelist PDA, seed-pinned epoch, cutoff, received-amount accounting, per-token pause | H | 2 |

## B. Supply and emissions

| Rule | Requirement | Class | Where / current | Required | Risk | Order |
|---|---|---|---|---|---|---|
| B1 | 100M genesis supply; no arbitrary Admin minting | PARTIAL | token program: `mint_tokens` now counts every mint (Admin or listed minter) against a lifetime cap of 100,000,000 whole tokens (`MintConfig.minted`), and `transfer_mint_authority` hands the mint to the vesolve Protocol PDA after genesis. Open: which mint SOLV3 uses on Devnet/mainnet is not derivable from the repos; Seth must run the handover (or create the mint with the Protocol PDA as authority) and read the authority back | read back mint authority after genesis | M | 1 |
| B2 | `E(n+1)=floor(E(n)·0.98)`, first 1.3M | PARTIAL | `vesolve/states/emission.rs::weekly_emission` is a 1e18 fixed-point power; verified (Python) to exceed the recurrence by a few base units from epoch 11 (1,712 of 5,001 epochs) | implement the recurrence | M | 8 |
| B3 | Gauge shares of N+1 emission by final N votes **[D] 4% dev carve-out, gauges 96%** | PARTIAL | `emission_split` = 4% developer, remainder gauges: matches **[D]**. Dev share minted at `initialize_epoch_emission` (`fund_emission.rs:64`). Gauge share = `gauge_budget·weight/total_voting_power` | ok; make rounding `dev + Σ gauges ≤ E` explicit | L | 8 |
| B4 | Emissions go to LPs; accrue continuously; **mint on claim** (**[D]**: mint at start, burn unearned at close) | CONTRADICTED | `fund_native_gauge` mints the whole gauge budget into the pool vault up front (`native_gauge.rs:196`); no burn/settle instruction; `carry_amount` carries forward | `settle_gauge_epoch` (permissionless) burning `minted − earned`; pool `unearned` counter | H | 4 |
| B5 | Unproductive periods earn nothing, not carried; prospective join | PARTIAL | DEX skips growth when `liquidity == 0` (`solve/manager/solve_manager.rs:20`): earn-side IMPLEMENTED; carry-forward and un-minted remainder CONTRADICTED (see B4) | see B4 | H | 4 |

## C. Productive Liquidity Weight

| Rule | Requirement | Class | Where / current | Required | Risk | Order |
|---|---|---|---|---|---|---|
| C base | in-range L-seconds | IMPLEMENTED | DEX accumulator, checkpoint at tick crossing (`solve_manager.rs`, `tick_manager.rs`) | none | – | – |
| C **[D]** | range floor spacing ≥ 64 on gauge pools | MISSING | no check at `open_position*` / `reset_position_range` | width check in canonical pools | H | 10 |
| C **[D]** | hourly activity gate φ = 1 bp/h; carry gate state across epoch | MISSING | none; legacy fee-weighted `GaugeStake` (`vesolve/states/emission.rs`, `gauge_stake.rs`) still exists and **is a rejected design (D)** | gate state in `NativeGauge`/pool ext; remove legacy stake path or keep isolated | H | 10 (blocked on Gate 3 cost) |
| C | no fee-scaled weight | IMPLEMENTED for native gauge, PARTIAL overall | legacy `GaugeStake` weights by fee growth | retire legacy after migration (`migrate_legacy_stake.rs`) | M | 10 |

## D. veSOLV3 Exit

| Rule | Requirement | Class | Where / current | Required | Risk | Order |
|---|---|---|---|---|---|---|
| D1 | Permanent locks, presale permanent, no expiry | IMPLEMENTED | `Lock.unlock_time = i64::MAX`, `is_expired` always false (`states/lock.rs`); presale minting not in repos → UNKNOWN | – | L | – |
| D2 | Exit disabled through week 4 | CONTRADICTED | `exit_lock` live, needs only `exit_config.lamports_per_solv3 > 0` (`exit_lock.rs:133`); frontend page exists (`frontend:src/app/[locale]/(ve)/lock/exit/page.tsx`, `useExitLock.ts`) | on-chain `exit_enabled_after` timestamp; frontend hidden/disabled as secondary | **C** | 1 |
| D3 | 40% fee in SOL to Treasury; Admin-changeable next epoch | IMPLEMENTED | initial 4,000 bps; `set_exit_fee_bps` (Admin, max 10,000) takes effect next epoch via `ExitFeeConfig`; `withdraw_exit_fees` pays only the Treasury in `AdminConfig`; fee rounds up (no free micro-exit) | none | – | done |
| D4 | Manipulation-resistant oracle, fail closed | CONTRADICTED (interim) | price = Admin-published `ExitConfig.lamports_per_solv3` via `set_exit_price` (frontend:`AdminExitPrice.tsx`); not an oracle | deferred to week-4 assessment; keep Exit disabled until then | C | 1 |
| D5 | Partial exit | IMPLEMENTED | `partial_exit_lock(ve_token_id, amount)`: fee on the exited part only, remainder stays locked in the same lock and ve token; same gates as `exit_lock` | none | – | done |
| D6 | Voted position cannot exit; no transfer/split bypass | IMPLEMENTED | `exit_lock.rs:138`, split/merge propagate flag, transfer blocked | keep when A8 relaxes transfer | – | 6 |

## E. Accounting and failure recovery

| Rule | Class | Where / current | Required | Risk | Order |
|---|---|---|---|---|---|
| `earned = claimed + outstanding` | PARTIAL | holds per claim via cursors/indices (`claim_*`, `states/reward.rs`), not asserted; no outstanding ledger | per-obligation `{earned, claimed}` and invariant test | M | 8 |
| Immutable earned, no recompute | PARTIAL | epoch weights fixed after cutoff; legacy vault vs native vault separation noted in `states/native_gauge.rs` | tests | M | 8 |
| Failed claim → retryable obligation; per-token isolation | MISSING | a failing CPI reverts the whole claim; multi-asset claim shares one path | per-asset claim, `FAILED_RETRYABLE` | M | 8 |
| Admin recovery executes, never redefines | MISSING | none | recovery instruction bounded by obligations | M | 9 |
| Treasury accrued/claimable | MISSING | Treasury is the `Protocol` PDA balance / Admin withdrawals | Treasury ledger (OPEN-3) | M | 9 |

## F. Admin, pauses, upgrades, events

| Rule | Class | Where / current | Required | Risk | Order |
|---|---|---|---|---|---|
| F1 single transferable Admin | PARTIAL | After initialization every vesolve admin action uses `Protocol.admin` (two-step transferable), DEX admin actions use the config's transferable `fee_authority` (feature flags moved off the compiled list; test `feature_flags_belong_to_the_transferable_fee_authority...`), SOLV3 mint uses `MintConfig.authority`. Compiled `ADMINS` arrays remain only as one-time bootstrap gates for `initialize`, `initialize_config` and `initialize_mint`; set them to the launch Admin key in the release build | set bootstrap keys at deploy | L | 3 |
| F2 independent pauses + nuclear | MISSING | no pause flags in any program (only per-position `is_paused` stake flag) | 8 flags + global; claims independent | H | 3 |
| F3 upgrade timelock 24h, cancel | DONE (program side) | vesolve `schedule_upgrade`/`cancel_upgrade`/`execute_upgrade` (24h, Admin-only, allowed under pause); both the program's upgrade authority and the buffer's must be the PDA `[upgrade_authority]`. Tests: `upgrade_timelock.rs`. Deploy step: hand each program's upgrade authority to that PDA | operational handover at deploy | M | 3 |
| F4 events | PARTIAL | `vesolve/events.rs`: protocol init, lock create/extend/update/burn/transfer/exit, exit price, gauge created, epoch updated, vault, reward claimed, auto-vote enroll/revoke/fees. Missing: listing, activation/removal, migration, whitelist, exit-fee change, allocation auto-vote, pause, upgrade, admin transfer | add events with each feature | L | with each |

## G. State machines and invariants (task G3 summary)

Full per-invariant mapping lives in `SOLVE3_FULL_LAUNCH_INVARIANTS.md` §2 (status column). Aggregate from that catalog:

| Class | IDs |
|---|---|
| IMPLEMENTED / enforced | S6, S7, S9, V5, V7, V8, A3, A6, E1, E4 |
| PARTIAL | S1, S8, V1, V2, V3, V6, A1, A2, E3, F4 |
| MISSING / CONTRADICTED | S2, S3, F3 (timing), F6, V4, V9, X1, X2, X3, G1–G5, B1–B4, A4, A5, P1–P5 |
| UNKNOWN | S4, F1, F2, F5, G6, B4 (route), E2 |

## Cross-cutting findings not in the handoff

1. **Which program owns SOLV3 minting is unresolved** (B1): two incompatible authority models exist in the repo. This is the highest-priority read-back because Rule M8 (no arbitrary minting) cannot be claimed until the on-chain mint authority is known.
2. **Fee policy is enforced by an off-chain keeper**, and the Devnet values differ from the frozen table (A2). The keeper "repairs" gauge creation races; that is operational, not contract-enforced (frontend doc). Per M3/M4 the policy must move on-chain.
3. **Admin identity is inconsistent across programs** and tied to a Windows-host operator workflow per frontend:`docs/claude-genesis-handoff.md`; key custody was not reviewed.
4. **Frontend-only controls found** (all rows below are NOT security controls): known SOLV3/xSOLV3 mints filtered from public Swap/pool entry (`claude-genesis-handoff.md:29`, explicitly "a frontend/app guard"); 1-hour vote cutoff display; token-listing request form (`TokenRequestForm.tsx`, `/api/admin/token-requests`); Exit page.
5. **A broken fee pipeline step** on Devnet: `DistributePoolReward` failing because `vault_token_account_a` was uninitialised (Anchor 3012) (frontend doc 2026-09-14), meaning voter-fee routing had not been exercised end to end at that date.

## Recommended implementation order (consolidated)

1. **B1/D2/D4** read back SOLV3 mint authority; hard-disable Exit until a week-4 on-chain timestamp.
2. **A12 bribes**: seed-pin epoch, cutoff, whitelist, received-amount accounting.
3. **F1/F2/F3 + A5**: admin config + pauses + upgrade schedule; cutoff to 23:55.
4. **A2/A11/B4/B5**: on-chain fee routing by state; settle-and-burn; pool `unearned` counter.
5. **A3/A4 + pair uniqueness**: pending activation/removal, `PairCanonical`, fresh gauge.
6. **A7/A8/A9**: position-keyed votes, reset, transfer relaxation, merge prohibition (ship together).
7. **A10/D3/D5**: allocation auto-vote, configurable exit fee, partial exit.
8. **B2/E**: emission recurrence; obligation ledger and failure recovery.
9. **A1/A6, Treasury ledger**, genesis/presale verification on Devnet.
10. **C**: range floor and activity gate after Codex C2 / Gate 3 cost.

## Not reviewed

Presale/claim programs and genesis tooling (not in these repos); `token-list`; frontend wallet flows beyond the files named; deployed program IDs, authorities and Devnet account state; `solve` swap/liquidity math beyond the paths cited; CPI compute costs; every `#[derive(Accounts)]` in `solve` (only `vesolve` instructions cited were read).
