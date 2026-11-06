# Solve3 Full Launch v1 — Invariants and State Machines

**Workstream:** Claude WS3 (handoff Part G, tasks G1 + G2). **Status:** DRAFT for Gate 2.
Source of truth is `Solve3-Full-Launch-Claude-Codex-Handoff.md` (Parts A–F). This document formalises those rules; it adds no economics. Where the handoff is silent the item is marked **OPEN** and nothing is assumed.

Notation: `N` = epoch index; `cutoff(N)` = Wed 23:55 UTC of epoch N; `rollover(N)` = Thu 00:00 UTC. All times are Solana `Clock::unix_timestamp` (trusted chain time).

---

## 1. State machines (G1)

### 1.1 Pool

```
UNLISTED ──list──▶ LISTED_UNGAUGED ──schedule_gauge(N)──▶ GAUGE_PENDING
                        ▲                                   │ rollover(N)
                        │ rollover(N) after removal         ▼
                  GAUGE_REMOVAL_PENDING ◀──request_removal(M)── GAUGE_ACTIVE
LISTED_UNGAUGED / GAUGE_* ──delist──▶ DELISTED
```

| State | Fee routing (A2) | Entry guard | Notes |
|---|---|---|---|
| UNLISTED | 95 LP / 5 Treasury / 0 Voters | pool creation (permissionless, A3) | |
| LISTED_UNGAUGED | 95 / 5 / 0 | Admin `list` | listing never changes routing |
| GAUGE_PENDING | 95 / 5 / 0 | Admin `schedule_gauge` in epoch N | UI shows pending; becomes ACTIVE at rollover(N) |
| GAUGE_ACTIVE | 0 / 0 / 100 | rollover(N) | one canonical pool per pair |
| GAUGE_REMOVAL_PENDING | **0 / 0 / 100** until rollover(M) | Admin `request_removal` in epoch M | normal through M; new bribes stop at request (A4) |
| LISTED_UNGAUGED (post-removal) | 95 / 5 / 0 | rollover(M) | fresh gauge required to reactivate (A4) |
| DELISTED | 95 / 5 / 0 | Admin `delist` | pool survives; claims survive (I12) |

Transition rules: `GAUGE_ACTIVE → GAUGE_PENDING` and `GAUGE_REMOVAL_PENDING → GAUGE_ACTIVE` are **forbidden** (relist uses a fresh gauge). `delist` from `GAUGE_ACTIVE` goes through `GAUGE_REMOVAL_PENDING` first. Canonical migration A→B is `Pool A: REMOVAL_PENDING` and `Pool B: PENDING` effective in the **same** rollover (A13), never both ACTIVE for one pair.

Fee routing is a function of `(state, accrual_time)`: fees accrued before a transition keep the routing in force when they accrued (A2, M7).

### 1.2 Gauge

```
NONE ──create+schedule(N)──▶ PENDING_ACTIVATION ──rollover(N)──▶ ACTIVE
ACTIVE ──request_removal(M)──▶ PENDING_REMOVAL ──rollover(M)──▶ REMOVED
```

`REMOVED` is terminal and keeps all earned claims. A relisted pool gets a **new** gauge account (new PDA seed component, e.g. `gauge_id`), never a reactivation of the old.

| Gauge state | May receive votes | May receive bribes | Earns emissions | Voter fees |
|---|---|---|---|---|
| NONE | no | no | no | – |
| PENDING_ACTIVATION | **yes** (OPEN-1 answered by Seth: votes in N may target a gauge pending for N+1; they set its N+1 emission) | no | no | no |
| ACTIVE | yes, until cutoff | yes, until cutoff | yes (votes of N-1) | 100% |
| PENDING_REMOVAL | no new votes toward it count for N+1 | **no** | through epoch M only | through M |
| REMOVED | no | no | no | no |

### 1.3 veSOLV3 position

Fields (handoff G1 minimum) mapped to the existing `Lock` account (`programs/vesolve/src/states/lock.rs`) and gaps:

| Field (G1) | Current code | Gap |
|---|---|---|
| `owner` | `Lock.owner` | – |
| `underlying_amount` | `Lock.amount` | – |
| `permanent_lock` | implicit (`is_expired` always false, `unlock_time = i64::MAX`) | no explicit field; fine if all locks are permanent |
| `voted_epoch` | `Lock.last_vote_epoch` | present (u64) |
| `original_epoch_voter` | **absent**; `UserVote` keyed by `(wallet, epoch)`, `VoteLockRecord` records `(user, epoch, lock)` | required by A8: needs `(position, epoch) → voter` |
| `vote_allocations` | `UserVote.votes: Vec<GaugeVote>` keyed per wallet, **not per position** | A8 says vote state follows position+epoch |
| `exit_eligibility` | derived `last_vote_epoch < current_epoch` | derivable; keep derived |

Position state (per epoch `N`):

```
UNVOTED(N) ──vote(by owner at time)──▶ VOTED(N, voter V)
VOTED(N, V) ──reset(by V, ≤ cutoff)──▶ UNVOTED(N)     (power may be reassigned immediately)
VOTED(N, V) ──vote again(by V, ≤ cutoff)──▶ VOTED(N, V) (replaces allocation)
any(N) ──rollover(N)──▶ UNVOTED(N+1)
```

Operation matrix (A8/A9/D6). "V" = recorded `original_epoch_voter`; "owner" = current owner.

| Operation | UNVOTED(N) | VOTED(N, V) |
|---|---|---|
| vote | owner | **V only**, ≤ cutoff (change) |
| reset | – | **V only**, ≤ cutoff; owner ≠ V rejected |
| transfer | allowed | **allowed**, vote state stays bound to (position, N, V) |
| merge | allowed (both unvoted) | **rejected** if either position VOTED(N) |
| split | allowed | child inherits VOTED(N, V) with **proportional** allocation; neither part Exit-eligible; V may reset/revote both before cutoff |
| exit (full/partial) | allowed after Week 4 + oracle (D2) | **rejected** |

> **Gap found in code:** `transfer_lock.rs:73-76` currently **rejects** transfer of a voted lock (`last_vote_epoch < current_epoch`). The handoff (A8) says *transfer while vote-flagged remains allowed*, with the vote state following the position. This is a behaviour divergence, not a security hole: the current rule is stricter. Whoever implements A8 must flip the rule **and** add the `original_epoch_voter` binding, never one without the other.

### 1.4 Reward obligation

```
ACCRUING ──epoch/period closes──▶ EARNED ──claimable_at──▶ CLAIMABLE
CLAIMABLE ──claim ok──▶ CLAIMED
CLAIMABLE ──transfer fails──▶ FAILED_RETRYABLE ──retry ok──▶ CLAIMED
FAILED_RETRYABLE ──retry fails──▶ FAILED_RETRYABLE
```

`EARNED` amount is immutable (E). No transition ever lowers or recomputes `earned`; only `claimed` grows. `FAILED_RETRYABLE` keeps the full outstanding amount, is idempotent per `(obligation_id)`, and survives rollover, gauge removal, delisting, ownership change, pause, upgrade (E).
Current code note: the vote-reward claim becomes claimable at N+1, when the voting epoch has ended (`Epoch::voting_rewards_claimable`). It was N+2 until Seth's 2026-10-13 decision to shorten it. **OPEN-2** (§6).

### 1.5 Upgrade (F3)

```
NONE ──schedule(t0)──▶ SCHEDULED ──t ≥ t0+24h──▶ EXECUTABLE ──execute──▶ EXECUTED
SCHEDULED/EXECUTABLE ──cancel(Admin)──▶ CANCELLED
```

Pause state is orthogonal: scheduling, cancelling and executing are allowed under nuclear pause (F3). **Current code has no upgrade-timelock account and no pause flags in vesolve or solve (grep for `pause` finds only `is_paused` stake flags).** All of F1–F3 is therefore MISSING at the program level (Codex to confirm against deployment authority config).

### 1.6 Epoch clock

`rollover(N)` is `update_epoch` (permissionless crank). Votes/bribes at `now ≥ cutoff(N)` revert. `cutoff(N) = rollover(N+1) − 300 s`. Both read `Clock`. Missed crank: `update_epoch` computes the boundary from `current_time`, so a late crank cannot move the *voting* window of the previous epoch backward, but while the crank is late, `protocol.current_epoch` is stale and votes remain open past rollover → **INV-E3** below.

---

## 2. Invariant catalog (G2)

Format: ID · statement · type (**S**=state/safety, **T**=transition, **X**=cross-account/aggregate, **L**=liveness) · enforcement point · how to test · status vs code (from my reading; Codex G3 owns the authoritative mapping).

Status key: ✅ appears enforced · ⚠️ partial · ❌ missing/contradicted · ❓ unknown.

### 2.1 Supply and emissions

| ID | Invariant | Type | Enforced where | Test | Status |
|---|---|---|---|---|---|
| **INV-S1** | No arbitrary SOLV3 minting: every mint call is traceable to `weekly_emission(N) × gauge share`; mint authority is a program PDA only | S | `token` program `mint_tokens`, `vesolve` mint sites | assert mint authority; fuzz that every `mint_to` amount ≤ scheduled | ⚠️ `token::mint_tokens` has minters list (`programs/token/.../minters.rs`); needs audit of each minter |
| **INV-S2** | `minted ≤ earned ≤ scheduled_max(N)` per epoch per gauge | X | emission accounting | mint-on-claim test I9 | ❌ F1: whole gauge budget minted at `fund_native_gauge`; **approved fix:** burn unearned at epoch close so net minted = earned |
| **INV-S3** | `E(N+1)=floor(E(N)·0.98)`, `E(0)=1,300,000·10⁹`; round-down, dust never minted | S | `states/emission.rs::weekly_emission` | property test vs reference over 5,000 epochs | ❌ **Verified divergence.** `weekly_emission` uses a 1e18 fixed-point power, not the B2 recurrence. Re-implemented both in Python: they differ at 1,712 of epochs 0–5000, first at epoch 11 (code 1,040,950,755,974,734 vs recurrence …733), always code ≥ recurrence by a few base units (≈1e-9 SOLV3). Tiny, but it can exceed the frozen scheduled maximum |
| **INV-S4** | Genesis supply is exactly 100,000,000 SOLV3 and `totalSupply = genesis + Σ minted` | X | token mint | I1 reconciliation | ❓ |
| **INV-S5** | Per epoch `dev_share + gauge_budget ≤ E(N+1)`, `dev_share = E − floor(0.96·E)`-consistent (4% carved out, **approved**); gauge budget is 100% LP; no other skim | S | `emission_split` | I9 | ✅ matches approved design (carve-out 4%); verify rounding so dev + gauges ≤ E |
| **INV-S6** | `Σ gauge_budget(N+1) ≤ E(N+1)` and `Σ_g share_g = ` rounded-down | X | `fund_native_gauge` check `distributed ≤ gauge_budget` | I9 multi-gauge | ✅ |
| **INV-S7** | Zero-vote gauge earns 0 SOLV3 | S | `fund_native_gauge` (`InvalidGaugeVotes`/`InvalidAmount` on zero) | I5/I9 | ✅ by revert, but the budget share goes to **no one** (not minted) — consistent with A7 |
| **INV-S8** | Unproductive period ⇒ no earned emissions, not minted, not carried | T | accumulator `liquidity==0` skip + settlement | I9 "no productive LP" | ⚠️ accrual skip ✅; carry forward ❌ (F1) |
| **INV-S9** | Joining/leaving liquidity is prospective only | T | Whirlpool checkpoint-before-change | I9/I10 | ✅ (DEX-native) |

### 2.2 Fees and routing

| ID | Invariant | Type | Enforced where | Status |
|---|---|---|---|---|
| **INV-F1** | Soft Launch: LP + Treasury = 100% (50/50) | S | fee config | ❓ |
| **INV-F2** | Full Launch non-gauged (UNLISTED, LISTED_UNGAUGED, GAUGE_PENDING, REMOVED): LP 95 + Treasury 5 = 100, Voters 0 | S | fee routing by pool state | ❓ (`protocol_fee_rate` 0 when inactive suggests LP keeps 100% of trading fee + protocol cut per `FeeTier`; 95/5 not located) |
| **INV-F3** | Active gauge: Voters = 100%, LP = Treasury = 0 | S | `set_protocol_fee_rate(10_000)` on activation + `route_pool_fees` | ✅ for routing rate; ❌ for timing (activation not deferred, F4) |
| **INV-F4** | Routing is determined by state **at accrual time**; transitions never reroute accrued fees | T | `route_pool_fees` sweep-before-transition | ✅ partly: deactivation requires `protocol_fee_owed == 0` (`GaugeFeesMustBeSwept`); activation path unchecked |
| **INV-F5** | `Σ(fee splits) = fees collected` exactly (no rounding leakage) | X | split arithmetic | ❓ |
| **INV-F6** | Gauge activation is effective only at the **next** rollover | T | schedule/activate state machine | ❌ F4 |

### 2.3 Voting, positions, exit

| ID | Invariant | Type | Enforced where | Status |
|---|---|---|---|---|
| **INV-V1** | One unit of veSOLV3 votes at most once per epoch: `Σ_g weight(position, N, g) ≤ power(position, N)` and no unit counted in two positions | S | `vote.rs` | ⚠️ per-**wallet** `UserVote` replace logic, not per position; two locks sharing a wallet vote through one `UserVote` (see §3.1) |
| **INV-V2** | Voting and bribe deposits revert at `now ≥ cutoff(N)` | T | `vote.rs`/`create_bribe.rs` | ⚠️ cutoff is end−1h (F5), bribe cutoff unverified |
| **INV-V3** | Transfer cannot reset voting eligibility: `voted_epoch` and `original_epoch_voter` survive any owner change | T | `transfer_lock.rs` | ⚠️ stricter than spec (transfer blocked); `original_epoch_voter` absent |
| **INV-V4** | Only `original_epoch_voter` can reset/revote a VOTED position in N, before cutoff | T | vote/reset | ❌ no reset instruction; revote is by wallet |
| **INV-V5** | Voted position cannot Exit in epoch N, including via split child | T | `exit_lock.rs:138`, `split_lock.rs:159` | ✅ propagates `last_vote_epoch` to child |
| **INV-V6** | Voted position cannot merge; unvoted may split/merge freely | T | `merge_lock.rs:94` | ⚠️ merge **propagates** the vote flag (`max`) instead of rejecting; spec A9 says **prohibited**. Safe but divergent |
| **INV-V7** | Aggregate voting power conserved across split/merge/transfer: `Σ power` unchanged | X | split/merge | ✅ `amount` conserved (tests exist in `lock.rs`) |
| **INV-V8** | No gauge minimum vote threshold; weights proportional to power | S | vote | ✅ |
| **INV-V9** | Protocol allocations: permanent lock, own wallet, auto-vote only by Admin config, changes before cutoff apply to current vote, abstain on unassigned | T | – | ✅ `register_allocation_voter` / `unregister_allocation_voter` (Admin); Admin votes a registered lock through `vote` with any share (<100% abstains); lapses if the lock changes owner; tests `admin_votes_a_registered_allocation...`, `admin_voting_lapses...`. Standing config: Admin `set_allocation_votes` (percent per gauge, version bump), permissionless `apply_allocation_vote` crank each epoch (skips gauges that no longer take votes; refused after cutoff or if the lock changed owner; a changed config or manual Admin vote is respected); tests `a_standing_allocation_vote...`, `admin_can_change_the_standing_vote...`, `the_standing_vote_skips...` |
| **INV-X1** | Exit disabled until week 4 after launch; fails closed on stale/missing oracle | T | `exit_lock.rs` | ❌ Exit live from day 0 with an **admin-published** price (`ExitConfig.lamports_per_solv3`, `set_exit_price`) |
| **INV-X2** | Exit fee = `fee_bps × SOL value` of exited amount, paid in SOL to Treasury; fee-bps change effective next epoch | T | `exit_lock.rs` | ✅ `set_exit_fee_bps` schedules for the next epoch; `withdraw_exit_fees` only to the Treasury (tests/svm/tests/exit_lock.rs) |
| **INV-X3** | Partial exit leaves remainder permanently locked, fee only on exited part | T | `exit_lock.rs` | ✅ `partial_exit_lock` (tests/svm/tests/exit_lock.rs) |

### 2.4 Gauges, listing, canonical pools

| ID | Invariant | Type | Status |
|---|---|---|---|
| **INV-G1** | At most one canonical ACTIVE (or PENDING_*) gauge per unordered token pair at any time | X | ✅ `PairCanonical` + `schedule_gauge_activation`; test `only_one_gauge_per_pair_is_canonical_and_migration_swaps_it_in_one_rollover` |
| **INV-G2** | SOLV3/SOL and SOLV3/USDC are distinct pairs, each with their own canonical | X | ❓ follows from G1 keyed by pair |
| **INV-G3** | Removal: normal through M; effective rollover(M); new bribes stop at request; earned claims remain | T | ✅ `request_gauge_removal` + executor in `configure_native_gauge(false)`; tests `fee_routing.rs`, `new_bribes_stop_when_removal_is_requested` |
| **INV-G4** | Relist uses a fresh gauge; old gauge never reactivates | T | ⚠️ relist reuses the Gauge account with `generation` + 1 (deviation, pending Seth); test `removal_is_requested_from_active_and_a_removed_gauge_relists_with_a_new_generation` |
| **INV-G5** | Canonical migration at epoch boundary only | T | ✅ `schedule_gauge_migration` sets both effective epochs equal; same test as G1 |
| **INV-G6** | Zero-vote gauge fees and bribes → Treasury | T | ❓ |
| **INV-G7** | Listing and gauge enablement are separate Admin actions | S | ⚠️ `create_gauge` / `configure_native_gauge` separate; no listing registry located |

### 2.5 Bribes

| ID | Invariant | Type | Status |
|---|---|---|---|
| **INV-B1** | Only whitelisted reward tokens can be deposited | S | ❌ no whitelist found (per-gauge cap `MAX_BRIBE_WEIGHT=20` only) |
| **INV-B2** | Bribe deposited in N rewards N voting and pays under N+1 lifecycle; no withdrawal | T | ⚠️ no withdrawal path ✅; lifecycle ❓ |
| **INV-B3** | Delisting a token blocks new deposits, preserves obligations; per-token pause for deposit/claim without freezing others | T | ❌ |
| **INV-B4** | Zero-vote and removed-gauge bribes → Treasury | T | ❓ |

### 2.6 Accounting and recovery (Part E)

| ID | Invariant | Type | Status |
|---|---|---|---|
| **INV-A1** | `earned = claimed + outstanding` per `(obligation)` for LP emissions, voter fees, bribes, Treasury rewards, at every instruction boundary | X | ⚠️ true per-claim by construction; not asserted on-chain; failure-path (`FAILED_RETRYABLE`) not modelled |
| **INV-A2** | `earned` is immutable after close; never recomputed with later weights | S | ⚠️ epoch `gauge_weights` is final once `fund` runs; verify no write path after end |
| **INV-A3** | A claim is idempotent: replay pays 0 (cursor advance atomic with transfer) | T | ✅ in `claim_*` index checkpoints; test double-claim I2/I17 |
| **INV-A4** | Admin recovery may execute existing obligations, never redefine them | S | ❌ no recovery tooling |
| **INV-A5** | Obligations survive gauge removal, delisting, pool migration, pause, upgrade, reward-token failure | T | ⚠️ pool-fee claim proven across a failed attempt and gauge removal (`earned_fees_survive_a_failed_claim_and_the_gauge_being_removed`); bribes proven across removal and a claims-pause cycle (`bribes_stay_with_voters_after_removal...`); upgrade path not yet |
| **INV-A6** | Rounding always floors toward the vault: `Σ paid ≤ Σ earned ≤ budget` | X | ✅ (sim §5.4 of PLW model) |

### 2.7 Admin, pause, upgrade, events (Parts F)

| ID | Invariant | Status |
|---|---|---|
| **INV-P1** | Eight independent pauses + nuclear; any pause immediate, unpause individually; claims restorable independently of other systems | ❌ none |
| **INV-P2** | Nuclear pause never blocks scheduling/finalising a remediation upgrade | ❌ |
| **INV-P3** | Upgrade executes only ≥24 h after schedule; cancellable; pauses bypass timelock | ✅ `schedule_upgrade` / `cancel_upgrade` / `execute_upgrade` in vesolve; tests in `upgrade_timelock.rs`. Binds only once each program's upgrade authority (and each buffer's) is set to the PDA `[upgrade_authority]` of vesolve: an operational step for Seth at deploy |
| **INV-P4** | Admin authority transferable without upgrade; initial single wallet | ❌ `ADMINS` is a compiled-in 2-key constant (`auth/admin.rs`); rotation needs an upgrade |
| **INV-P5** | Events exist for listing, gauge lifecycle, migration, whitelist, exit-fee, auto-vote config, pause, upgrade, admin transfer | ⚠️ `events.rs` partial; most do not exist because the features do not |

### 2.8 Epoch

| ID | Invariant | Type | Status |
|---|---|---|---|
| **INV-E1** | Epochs weekly; `rollover` at Thursday 00:00 UTC | S | ✅ unix-week boundary |
| **INV-E2** | Genesis epoch is a normal voting epoch; presale + protocol allocations vote; no previous stream | S | ❓ |
| **INV-E3** | Votes/bribes revert after `cutoff(N)` regardless of whether the permissionless `update_epoch` crank has run | T | ⚠️ cutoff uses `epoch.end_time` of the account, which is correct only if that epoch account was created with the true end; a late crank **delays** `current_epoch` but `end_time` stays fixed, so cutoff is enforced by time. Needs test |
| **INV-E4** | Final state at cutoff determines N+1 weights; later `update_epoch` cannot change them | T | ✅ weights written only in `vote` (blocked after cutoff) |

---

## 3. Cross-cutting design requirements these invariants impose (for Codex)

### 3.1 Vote state follows position + epoch

A8 cannot be met by per-wallet `UserVote(owner, epoch)`. Required: `PositionVote(position_id, epoch) → { voter, power, allocations[] }`, written by `vote`, checked by `reset`, `vote`, `exit`, `split`, `merge`, and carried through `transfer`. Epoch tallies must be updated by delta against the *position's* previous allocation, not the wallet's. Recommendation (non-economic): key the PDA by `(ve_token_id, epoch)`; derive voter from the signer recorded at first vote.

### 3.2 Fee routing as a function of state, not a flag

Replace the boolean `is_active` + immediate fee-rate flip with the §1.1/§1.2 state machine and a transition applied at rollover (`activate_pending`, `finalize_removal`), each gated by a sweep so INV-F4 holds by construction (sweep of old-routing fees must complete in the same transaction as the routing change; the code already requires that for removal).

### 3.3 Canonical uniqueness

Add a `PairCanonical(pair_key)` PDA (`pair_key = sorted(mintA, mintB)` hashed) that stores `{ canonical_pool, gauge_id, effective_epoch }`. All gauge schedule/activate/migrate instructions take it as `mut` and fail if `canonical_pool != pool` or a pending migration exists. This makes INV-G1/G5 true by account derivation, not by Admin discipline.

### 3.4 Obligations ledger

For every payer-of-last-resort stream (LP emissions, voter fees, each bribe asset): `{ earned_total, claimed_total }` kept per `(source, epoch)` with `outstanding = earned − claimed` derived; a failing transfer rolls back **only the transfer**, never the `earned` write. Pattern: claim instruction moves `claimed` after CPI success; separate `retry_claim` instruction is just the same claim, idempotent.

---

## 4. Property/fuzz tests I would require for Gate 2/4

1. `INV-S3`: for `n ∈ [0, 5000]`, compare `weekly_emission(n)` to iterative `E←floor(E·98/100)` from 1,300,000e9. If they differ at any `n`, the frozen B2 rule says the iterative form wins. (Already run offline: 1,712 mismatches in 0–5000, see INV-S3.)
2. `INV-V1/V4`: model-based test with random interleavings of vote/reset/transfer/split/merge/exit across 3 wallets and 5 positions; invariant after every step: `Σ epoch weights = Σ position allocations`.
3. `INV-A1/A6`: for random fee/emission streams, random claim ordering, forced CPI failure on k% of claims: `earned == claimed + outstanding` at every step.
4. `INV-G1/G5`: random schedule/activate/remove/migrate sequences across two pools of one pair: never two PENDING/ACTIVE.
5. `INV-F4`: swaps interleaved with every state transition; assert fee buckets keep the routing at their accrual time.

## 5. Open items / not assumed

| ID | Question | Why it matters | Default if unanswered |
|---|---|---|---|
| **OPEN-1** | Can votes in epoch N target a gauge that is PENDING_ACTIVATION (activates at N+1), so that it has weight for N+1 emission? A3 says gauge becomes active "at the next epoch"; A6/B3 say N votes drive N+1 emissions. If votes cannot target pending gauges, a newly enabled gauge has zero votes in its first active epoch ⇒ it earns zero emissions and its fees/bribes go to Treasury (A7). | Determines whether any new gauge can earn in its first week | **ANSWERED (Seth, 2026-10-01): YES** — votes in N may target gauges PENDING for N+1. Gauge table row PENDING_ACTIVATION "May receive votes" is therefore **yes (counts toward N+1)**. |
| **OPEN-2** | Voter reward hold. **ANSWERED: keep N+2 (2026-10-01); CHANGED to N+1 (2026-10-13).** | Obligation state machine `EARNED→CLAIMABLE` timing | Handoff silent ⇒ treat current N+2 as a deviation to be confirmed |
| **OPEN-3** | Treasury "5%" and SOLV3 exit-fee destination: Treasury wallet identity and whether it is a single PDA or Admin wallet | Part E "Treasury-directed value" | – |
| OPEN-4 | `ADMINS` currently holds **two** keys; F1 says initially one wallet | INV-P4 | – |

## 6. Appendix — code observations while mapping (feeds Gate 1; Codex owns authoritative matrix)

| Handoff rule | Observed | Class |
|---|---|---|
| B2 `E(n+1)=floor(E(n)·0.98)` | fixed-point power; ≥ recurrence by a few base units from epoch 11 | CONTRADICTED (tiny) |
| B3/B4 emission 100% to LPs | 4% developer allocation `emission_split` | **RATIFIED by Seth 2026-10-01** (carved out of the 1.3M); not a contradiction |
| B4/B5 mint on claim, not carried | mint-to-vault at `fund_native_gauge`, `carry_amount` | CONTRADICTED (F1); approved remedy = burn unearned at epoch close |
| A3 activation at next epoch | immediate flip | CONTRADICTED (F4) |
| A5 cutoff 23:55 | end − 1 h | CONTRADICTED (F5) |
| A8 transfer allowed while voted | blocked while voted | CONTRADICTED (stricter) |
| A9 merge prohibited if voted | merge propagates flag | PARTIAL |
| A9 split cannot launder | child inherits `last_vote_epoch` | IMPLEMENTED |
| D2 Exit disabled 4 weeks | Exit enabled with admin-set price | CONTRADICTED |
| D5 partial exit | `partial_exit_lock` | IMPLEMENTED |
| D3 fee Admin-changeable next epoch | constant 40% | MISSING |
| F1 admin transferable | compiled 2-key array | CONTRADICTED |
| F2 pauses, F3 timelock | none in program | MISSING |
| A12 bribe whitelist | none | MISSING |
| A4/A13 removal/migration/uniqueness | none; gauge keyed by pool | MISSING |
| A10 protocol allocation auto-vote | public keeper auto-vote only | MISSING |

All rows are from reading `programs/vesolve` and `programs/solve` at `55ccd9b`; none were executed.
