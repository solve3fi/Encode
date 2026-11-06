# Solve3 Full Launch v1 — Protocol Specification

**Workstream:** Claude WS1. **Status:** DRAFT for Gate 1 (specification consistency with Codex's requirements matrix).
**Source:** `Solve3-Full-Launch-Claude-Codex-Handoff.md` Parts A–F, plus decisions Seth approved on 2026-10-01 (marked **[D]**). This spec restates frozen rules as normative requirements. It does not add or change economics. Anything the handoff leaves open is in §12 and is not assumed.

Keywords **MUST / MUST NOT / MAY** are normative. Rule IDs (A1…F4) refer to the handoff; invariant IDs (INV-…) refer to `SOLVE3_FULL_LAUNCH_INVARIANTS.md`. Companion: `PRODUCTIVE_LIQUIDITY_WEIGHT_MODEL.md`.

---

## 1. Definitions

| Term | Meaning |
|---|---|
| Epoch N | Weekly period. Starts Thursday 00:00 UTC (rollover). |
| Cutoff(N) | Wednesday 23:55 UTC, 5 minutes before rollover(N+1). |
| Pair | Unordered `{mintA, mintB}`. SOLV3/SOL and SOLV3/USDC are different pairs. |
| Canonical pool | The single pool of a pair eligible for a gauge. |
| Position | A veSOLV3 lock (permanent). |
| Gauge-managed pool | A pool in state GAUGE_ACTIVE or GAUGE_REMOVAL_PENDING. |
| Treasury | The Treasury wallet/PDA receiving fees, Exit fees and redirected rewards. Identity is OPEN-3. |

## 2. Epoch clock (A5, A6)

1. Epochs MUST be 7 days, rolling over Thursday 00:00 UTC (unix-week boundary).
2. Voting and bribe deposits MUST revert when `Clock::unix_timestamp ≥ cutoff(N)`. Enforcement MUST use chain time only, and MUST NOT depend on whether the permissionless `update_epoch` crank has run.
3. The genesis epoch is a normal voting epoch. Presale holders vote, protocol allocations auto-vote, and there is no prior-epoch reward stream. Epoch N votes determine N+1 emissions and rewards.

## 3. Fee routing (A1, A2)

| Mode / pool state | LP | Treasury | Voters |
|---|---:|---:|---:|
| Soft Launch (only) | 50% | 50% | 0% |
| Full Launch: UNLISTED | 95% | 5% | 0% |
| Full Launch: LISTED_UNGAUGED, GAUGE_PENDING | 95% | 5% | 0% |
| Full Launch: GAUGE_ACTIVE, GAUGE_REMOVAL_PENDING | 0% | 0% | 100% |
| After removal takes effect, DELISTED | 95% | 5% | 0% |

- Routing is selected by **gauge activation**, never by listing.
- Fees accrued under one routing MUST be settled under that routing; a state transition MUST NOT reroute them (M7). Implementation MUST sweep pre-transition fees atomically with, or before, the transition.
- Splits MUST be exact: `LP + Treasury + Voters = fees collected` with no leakage (INV-F5).

## 4. Pools, listing, gauges (A3, A4)

1. Pool creation with an unlisted token MUST be permissionless.
2. Projects request official listing; Admin approves. Admin separately enables gauges from the Admin page.
3. A gauge enabled in epoch N MUST become active at rollover(N). The UI MUST show pending activation. **[D] Votes cast in epoch N MAY target a gauge pending for N+1 and set its N+1 emission** (answers OPEN-1; the alternative would give every new gauge a dead first week).
4. There MUST be at most one canonical gauge-eligible pool per pair at any time. Canonical migration MUST occur at an epoch boundary and MUST NOT ever create two simultaneous canonical gauges for a pair.
5. Removal requested in epoch M: new votes for the gauge are refused from the request (DEV-8; votes already cast stay), the gauge otherwise runs normally through M; effective rollover(M); fees return to 95/5 thereafter; new bribes stop at the request; earned claims remain valid; stranded/future bribes for the removed gauge go to Treasury. Relisting MUST use a fresh gauge.
6. State machines: `INVARIANTS §1.1` (pool) and `§1.2` (gauge) are normative for transitions.

## 5. Voting (A7–A10)

1. A position's voting power MAY be split across gauges. Votes may be reset/changed until cutoff; only the final state determines N+1 weights. Reset power MAY be reassigned immediately before cutoff.
2. There is no minimum vote threshold. A gauge with zero votes receives zero SOLV3 emissions; its fees and bribes go to Treasury.
3. **Vote state follows `(position, epoch)`, not the current owner (A8):**
   - Only the original voter of a voted position can reset or change that epoch's vote.
   - A position that has voted this epoch MUST NOT be transferred until rollover (`LockHasActiveVotes`, DEV-1). Because it cannot change hands while voted, the recipient can never reset, revote, Exit, or split voted power into an Exit-eligible child; only the current owner can vote or change a vote.
   - Epoch rollover clears vote status.
4. **Split/merge (A9):** unvoted positions split/merge freely; if either position has voted this epoch, merge MUST be rejected; a voted position cannot Exit; a split MUST NOT launder voted voting power into unvoted Exit eligibility.
5. **Protocol allocations (A10):** Treasury, Team, Advisors, etc. each hold permanently locked veSOLV3 in their own wallet. Admin configures auto-vote amount and target gauge(s) per allocation; 100% to one gauge is allowed; unassigned power abstains; changes before cutoff apply immediately to the current vote; votes are public. Each allocation earns proportional voter fees/bribes into its own wallet.
6. **Public auto-vote (DEV-12):** any lock owner MAY enroll a lock in auto-vote and revoke at any time. The auto-voter takes `AUTO_VOTE_FEE_BPS` (15%) of what an enrolled lock claims. Enrollment is not Admin-gated. Later versions SHOULD let any wallet register as an auto-voter at the same 15% fee instead of a single keeper key.

## 6. Voter rewards and bribes (A11, A12)

1. For an active gauge, voters receive trading fees (100%) and every approved bribe asset in proportion to their share of that gauge's vote weight.
2. Bribes: approved/whitelisted tokens only; Admin controls the whitelist. Deposit cutoff = Cutoff(N). Deposits in N reward N voting and pay under the N+1 lifecycle. No withdrawals after deposit. No protocol-level minimum.
3. Zero-vote and removed-gauge bribes go to Treasury.
4. Delisting a reward token MUST block new deposits and MUST preserve obligations. Admin MAY pause a specific reward token's deposits/claims without freezing others.

## 7. SOLV3 supply and emissions (B1–B5)

1. Genesis supply is exactly 100,000,000 SOLV3. It is not a cap. There MUST be no arbitrary Admin minting.
2. Weekly schedule: `E(0)=1,300,000 SOLV3` (first maximum scheduled weekly emission), `E(n+1)=floor(E(n)·0.98)` with deterministic round-down at token precision, indefinitely. Dust is never minted. **The recurrence is the normative definition** (see INV-S3 for the verified drift in the current fixed-point implementation).
3. **[D]** Each weekly scheduled emission `E(N+1)` is split: **4% liquid SOLV3 to the developer wallet** and the remaining **96% is the gauge budget** (carved out of, not added to, the 1.3M schedule). Final epoch-N voting fixes each gauge's share of the gauge budget: `budget_g = floor(0.96·E(N+1)·votes_g / total_votes)`. Developer share is `E − gauge budget` computed with the same round-down so `dev + Σ budget_g ≤ E`.
4. The gauge budget goes **entirely to LPs** (the dev 4% is not a gauge emission). Gauge vote weight sets the pool's budget; LP productive weight splits it inside the pool. Entitlement accrues continuously/event-driven. **[D] Settlement:** the gauge budget may be minted into the pool reward vault at epoch start, but **at epoch close a permissionless settlement instruction MUST burn every unearned unit** (time with no productive liquidity, gate-closed hours, unclaimed-by-design remainder), so that after settlement `minted_net = earned ≤ scheduled maximum`. Total SOLV3 minted and not burned, including the developer share, MUST never exceed the epoch's `E`; supply growth per epoch ends ≤ 1,300,000 × 0.98ⁿ.
5. No productive liquidity for a period ⇒ no emissions earned for that period; they are not minted, redistributed, carried forward, or retroactively claimable. A gauge with votes but no liquidity retains its epoch budget so LPs arriving later earn **prospectively**; if productive liquidity exists for 60% of an epoch, only the productive-time portion can be earned.

## 8. Productive Liquidity Weight (Part C, approved 2026-10-01)

Normative detail is in `PRODUCTIVE_LIQUIDITY_WEIGHT_MODEL.md`. Summary of what was approved:

- Base weight: in-range liquidity-seconds (`w_i = ∫ L_i·R_i dt`), accumulated by the DEX reward-growth accumulator.
- **[D] Range-width floor:** CHANGED 2026-10-01 (Seth): every fee tier (tick spacing ≥ 1) is gauge-eligible so stablecoin pairs can earn emissions. The earlier floor of spacing 64 is removed; micro-range farming (threat T3) is now limited only by the activity gate on real capital.
- **[D] Activity gate:** an hour's emission is earned only if the previous hour's fee yield in the pool was ≥ 1 bp per hour; idle in-range liquidity with no trading earns nothing. Gate threshold/bucket length are Admin-adjustable with **next-epoch** effect.
- **[D]** The previous epoch's closing gate state carries into the first hour of the next epoch.
- Fees act only as a pool-wide eligibility signal and MUST NOT scale an individual position's weight.
- Implementation remains blocked until Gate 3 (Codex C2 cross-review).

## 9. veSOLV3 Exit (Part D)

1. Presale launches as permanently locked veSOLV3; protocol allocations are permanently locked; there is no normal expiration; presale claims have no deadline.
2. Exit MUST be completely disabled through the first **4 weeks** after launch. Afterwards it MUST fail closed if required pricing is stale, missing or unsafe.
3. Initial Exit fee: 40% of exited position value, paid in SOL, 100% to Treasury. Admin MAY change the percentage, effective next epoch.
4. Pricing MUST use a manipulation-resistant SOLV3 valuation and SOL/USD conversion; instantaneous spot MUST NOT be used. Oracle/TWAP architecture is deferred to the Week-4 assessment (not frozen).
5. Partial Exit is allowed: the fee applies only to the exited amount; the remainder stays permanently locked.
6. A position that voted in the current epoch MUST NOT Exit; transfer and split MUST NOT bypass this.

## 10. Accounting and recovery (Part E)

For LP emissions, voter fees, bribes and Treasury-directed rewards: `EARNED = CLAIMED + OUTSTANDING` at every instruction boundary. Rewards MUST survive failed claim/transfer, epoch rollover, gauge removal, token delisting, pool migration, position transfer, pause, upgrade and reward-token failure. Failed distributions use immutable earned accounting with retryable, idempotent recovery. An old obligation MUST NOT be recomputed with later weights and MUST NOT be paid twice. Admin recovery tooling MAY execute existing obligations and MUST NOT redefine them. Treasury-directed value SHOULD use accrued/claimable accounting rather than relying only on automatic transfers. Obligation state machine: `INVARIANTS §1.4`.

## 11. Admin, pauses, upgrades, events (Part F)

1. **Admin:** initially a single wallet; authority transferable without a program upgrade (for a later multisig).
2. **Pauses:** independent immediate pauses for swaps, liquidity changes, voting, bribes, claims, Exit, gauge activation and emissions, plus one global (nuclear) pause. Admin may unpause each system, or the global pause, immediately after remediation. A nuclear pause may stop claims; claims can be restored independently while other systems stay paused.
3. **Upgrades:** programs remain upgradeable; upgrade authority is Admin; 24-hour timelock; Admin may cancel during the timelock; emergency pauses are immediate and bypass the timelock; a nuclear pause MUST NOT block scheduling or finalising a remediation upgrade.
4. **Events:** on-chain events MUST exist for at least listing/delisting, gauge creation/activation/removal, canonical migration, bribe whitelist changes, Exit fee changes, protocol auto-vote changes, pause/unpause, upgrade schedule/cancel, and Admin authority transfer.

## 12. Open items (not assumed)

| ID | Item | Status |
|---|---|---|
| OPEN-1 | Votes targeting a pending gauge | **ANSWERED: yes** (2026-10-01) |
| OPEN-2 | Voter-reward claim hold | **ANSWERED: keep N+2** (2026-10-01), **CHANGED to N+1** (2026-10-13): claimable once the voting epoch has ended. Spec §6 hold is now N+1. |
| OPEN-3 | Treasury identity (single PDA vs Admin wallet) and where each Treasury-directed stream is accrued | Open |
| OPEN-4 | Current code has two compiled-in admin keys; F1 says initially one wallet | Open |
| OPEN-5 | Developer 4% allocation | **ANSWERED (2026-10-01):** 4% liquid SOLV3 to the dev wallet, **carved out of the 1.3M** (gauges share 96%). |
| OPEN-6 | Mint mechanism | **ANSWERED (2026-10-01):** most secure/simple route with end state ≤ 1.3M minted: mint at epoch start, permissionless burn of unearned at epoch close (§7.4). Exact burn amount needs a pool-level `unearned` counter (Codex C2 to cost). |

## 12a. Implementation notes from the Devnet rehearsal (2026-10-02)

Observed on Devnet (fast epochs); evidence in `evidence/devnet-2026-10-01.md`. These do not change the MUSTs above; where behaviour differs from a MUST the row says so and who must decide.

| ID | Observation | Status |
|---|---|---|
| DEV-1 | **Voted locks cannot be transferred in their voted epoch** (`transfer_lock` -> `LockHasActiveVotes`); the transfer is allowed once the epoch rolls. §5.3 says transfer while vote-flagged is *allowed* but must not change vote state. The implementation is stricter, which also makes transfer laundering impossible and means only the current owner can vote or change a vote (`InvalidOwner` otherwise). | **Decided 2026-10-08 (Seth: apply recommendations): keep the stricter rule; §5.3 amended.** |
| DEV-2 | **Relist reuses the gauge account** with `generation + 1` (status goes REMOVED -> PENDING_ACTIVATION). §4.5 says relisting MUST use a fresh gauge. Obligations stay keyed per epoch, so nothing is lost. | **Differs from §4.5; Seth to confirm** wording ("fresh generation") or require a new account. |
| DEV-3 | `route_pool_fees` moves everything the pool has accrued into the *current* epoch's vault. Fees earned in earlier epochs but routed late belong to the later epoch's voters. | A keeper must route every epoch before rollover; not enforced on-chain. |
| DEV-4 | Votes do not roll over: every lock must vote again each epoch; epoch N votes fund emission epoch N+1; an epoch with no votes mints the developer 4% but no gauge budget (`fund_native_gauge` -> `InvalidVotingPower`). | Developer share minting in an unfundable epoch **accepted by Seth (2026-10-02)**. |
| DEV-5 | Claimers' token accounts had to exist before claiming (`AccountNotInitialized`). | `claim_bribe_reward` now creates the claimer's ATA on first claim (fixed in this branch). `claim_pool_reward` still takes any token account the claimer owns (deliberate flexibility); clients/keepers must create it first (idempotent ATA instruction). |
| DEV-6 | Hardcoded vesolve ID in `solve` (`set_gauge_emissions.rs`) must match `vesolve`'s `declare_id!`; a unit test in `vesolve` now fails when they diverge. | Guard added in this branch. |
| DEV-7 | Fast-epochs builds scale the activity gate default threshold to 1 ppm (`gate.rs`); the release default stays 100 ppm (1 bp per hour). Without this a 7 second bucket needs about 3% pool turnover and LPs earn nothing. | Fixed in this branch. |
| DEV-8 | **New votes for a gauge are refused as soon as its removal is requested** (`accepts_votes()` is true only for PENDING_ACTIVATION and ACTIVE; a PENDING_REMOVAL gauge returns `InvalidGauge`). Spec §4.5 says the gauge is "normal through M". Votes already cast stay; bribes stop at the request (as specified). Refusing new votes is protective because the gauge gets no emissions after rollover, but it is stricter than the text. | **Decided 2026-10-08 (Seth: apply recommendations): keep the stricter rule; §4.5 amended.** |
| DEV-9 | **The exit fee has no floor.** The Admin may set any value from 0% to 100% (`MAX_EXIT_FEE_BPS = 10_000`); the fee is `ceil(amount x price x bps / 10^13)`, so at 0 bps an exit costs nothing (the round-up only guards tiny exits while the rate is above zero). Verified on Devnet at 20/25/40/100/0%. | **Decided by Seth (2026-10-02): no floor.** |
| DEV-10 | **Fees routed into an epoch where the gauge has no votes are unclaimable.** `route_pool_fees` has no vote-weight guard and the program has no instruction to recover such a vault (Devnet rehearsal 3: epoch 3 had no votes, yet about 205 tUSDC + 1,012 SOLV3 and 198 tUSDC + 1.18 tSOL were routed into its vault). §5.2 says a zero-vote gauge's fees and bribes go to the Treasury: bribes are covered (`sweep_unvoted_bribe`, permissionless after the epoch, moves only the recorded bribe amount), trading fees are not. | **Mitigated in the keeper (2026-10-08):** the epoch keeper routes only gauges that have voting power in the epoch being routed; otherwise fees stay in the pool counters and roll into a later epoch. **Program follow-up for the next audited release:** extend the sweep to the fee balances of zero-vote epoch vaults (and add an optional on-chain guard in `route_pool_fees`) so §5.2 is enforced on-chain for fees too. |
| DEV-11 | **Removed-gauge fee rate.** `configure_native_gauge(false)` sets the pool's protocol fee rate to 500 bps (`UNGAUGED_PROTOCOL_FEE_RATE`) and `sweep_ungauged_pool_fees` only accepts exactly that rate, but the epoch keeper reconciles ungauged pools to 0 bps (LPs keep 100%). Fees owed at the moment the keeper resets the rate cannot be swept, and the program refuses to activate a gauge while counters are nonzero (`GaugeFeesMustBeSwept`). | **Fixed in the Admin UI (2026-10-08):** "Switch on" settles owed fees in the same transaction, with the Treasury sweep at 500 bps and, at any other rate, a DEX collect (collect-fees authority) forwarded to the Treasury. The keeper stays fee-rate-only by design. Align the two numbers (program 500 vs keeper/UI 0) in the next release. |
| DEV-12 | **Auto-vote.** `enroll_auto_vote` is not Admin-gated: any lock owner can enroll and revoke. The auto-vote fee is `AUTO_VOTE_FEE_BPS = 1,500` (15%), applied to claims for enrolled locks. Today one fixed keeper key (`AUTO_VOTE_KEEPER`) casts the votes. | **Decided 2026-10-08 (Seth): keep enrollment open to everyone at 15%.** Roadmap: let any wallet act as an auto-voter (a registry of auto-voters with the same 15% fee, replacing the single keeper key); requires a program change. |
| DEV-13 | **Cancelling a scheduled upgrade leaves the buffer with the timelock** (`cancel_upgrade` removes the schedule but does not close the buffer or return its authority; about 1.84 SOL for the token program). | Operational: reuse the buffer in a later schedule, or accept the rent as sunk. Runbook section 5. |
| DEV-14 | **One canonical gauge per token pair:** scheduling a second pool of a pair that already has a gauge (pending activation, active or pending removal) is refused with `PairHasGauge`. | Admin UI now disables those pools in Add Gauge and labels them (2026-10-08). |
| DEV-15 | **Auto-vote fee destination.** The 15% fee is paid into the Protocol PDA's own token accounts (not the Treasury wallet's). `withdraw_auto_vote_fees` (Admin only, one call per mint) pays out to the **Admin's own** token account: unlike exit fees (`withdraw_exit_fees`, Treasury only, `InvalidTreasury` otherwise) the destination is not restricted to the Treasury. Verified on Devnet: enrolled claim paid exactly floor(15%) into the Protocol PDA accounts and the withdrawal moved exactly that amount; the Treasury wallet received nothing. | **Seth to decide; recommended:** restrict the destination to a token account owned by `AdminConfig.treasury`, like exit fees (program change, next audited release). |
| DEV-16 | **Gauge-managed pool detection.** A pool managed by the clean `solve` program has the managed flag in reward slot 1's extension bytes and a valid activity-gate record (marker `0xA5`) in slot 2's (`Solve::has_gauge_reward`). Slot 2 is not empty. The epoch keeper and the UI required slot 2 to be all zero (the old layout), so once a gauge went active the keeper refused to run ("Native gauge migration required", fail-closed) and the UI skipped the epoch-end cap on native reward quotes. | **Fixed 2026-10-08** in the keeper library and the UI with the program's exact rule (regression test uses live pool bytes). Any other client must mirror `has_gauge_reward`, not an all-zero slot 2. |
| DEV-17 | **Completing a removal settled owed fees by routing into the current epoch's vault.** Once a removal is due the gauge refuses new votes (DEV-8), so that vault has no voters and the routed fees would be unclaimable (DEV-10). | **Fixed in the Admin UI (2026-10-08):** route only when the gauge has voting power in the current epoch; otherwise settle the owed fees to the Treasury in the same transaction (spec 5.2). Verified on rehearsal 4. |
| DEV-18 | **The keeper funded a gauge whose removal was due.** Its stream stops at removal, so the funded emission was minted and then burned as unearned (conservation holds). | **Fixed in the keeper (2026-10-08):** gauges whose removal is due are not funded; their share is not minted, like a gauge without votes. |

## 13. Conformance

An implementation conforms when every MUST above is enforced on-chain (M3: frontend restrictions are not controls; M4: assume users call programs directly), every INV in the invariants catalog has an automated test (Gate 4), and the phased Devnet plan (Part I) passes with balance and event evidence (Gates 5–6).
