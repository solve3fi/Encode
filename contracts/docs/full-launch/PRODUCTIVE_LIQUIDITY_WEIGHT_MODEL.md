# Productive Liquidity Weight (PLW) — Candidate Models and Recommendation

**Workstream:** Claude WS2 (handoff Part C, task C1). **Status:** Decisions D1–D4 APPROVED by Seth 2026-10-01; cross-review with Codex C2 pending (Gate 3). **Blocks:** any implementation of productive-weight code.
**Rule:** nothing here changes frozen economics (Parts A, B, D–F). Every number marked **PROPOSED** is a parameter Seth must approve; none is a frozen rule.

Evidence: `sim/plw_sim.py` (deterministic, seed 7, `python3 plw_sim.py`). Code facts cite `programs/solve` and `programs/vesolve` at commit `55ccd9b`.

---

## 1. What the frozen rules require of the weight

From A2/A11/B3–B5/C, a candidate must satisfy all of:

| # | Requirement | Source |
|---|---|---|
| R1 | Pool budget is fixed by N votes; the weight only splits it **inside** the pool | B3, B4 |
| R2 | No productive liquidity for a period ⇒ that period's emission is **not earned** (not minted, redistributed, carried, or claimable later) | B5 |
| R3 | A gauge with votes and zero liquidity keeps its budget; LPs arriving later earn **prospectively** only | B5 |
| R4 | Out-of-range / dead / non-productive capital earns zero | C |
| R5 | Tighter *useful* liquidity may outperform wide inefficient liquidity | C |
| R6 | Raw fees/volume must not **directly** set weight; fees are at most an eligibility signal | C |
| R7 | One microscopic trade cannot activate a position for a whole epoch | C |
| R8 | One productive LP may take 100% of the accruing stream | C |
| R9 | Joining/leaving is prospective; splitting a position cannot raise aggregate weight | C |
| R10 | Survives flash liquidity, wash trading, tick/range manipulation, sybil splitting, rounding | C |

Note on LP economics that drives the threat model: in an **active gauge LPs receive 0% of trading fees** (A2). Their only income is SOLV3 emissions. So an LP's incentive to game the weight is the full emission share, and fee-based gates are paid by the *attacker to voters*, not to themselves (unless the attacker also holds the votes).

## 2. What the DEX already provides (inventory for C2, from reading code)

| Fact | Where |
|---|---|
| Pool `liquidity` = in-range liquidity only; changes at tick crossings | `programs/solve/src/state/solve.rs:30` |
| Global reward growth per unit liquidity: `Δgrowth = Δt · rate_x64 / pool.liquidity`, **skipped entirely when `liquidity == 0`** | `manager/solve_manager.rs:7-52` |
| Growth is checkpointed before every tick crossing, so out-of-range positions earn nothing for the interval after they exit range | `manager/solve_manager.rs` comment + `native_gauge_tests` |
| Per-position reward = `liquidity × (growth_inside − checkpoint)` using per-tick `reward_growths_outside` | `manager/tick_manager.rs:146` |
| Gauge stream is clipped at `gauge_reward_end_timestamp()` even with an offline keeper | `solve_manager.rs:31-35` |
| Reward slot 0 is gauge-managed (`GaugeRewardManaged` blocks manual changes) | `state/solve.rs:228,239` |
| Position range, `fee_growth_checkpoint_{a,b}`, `fee_owed_{a,b}` per position | `state/position.rs` |
| Legacy fee-weighted gauge: weight = `isqrt(Δfee_owed_a · Δfee_owed_b)` if in range | `vesolve/states/emission.rs:96-250`, `instructions/gauge_stake.rs` |

**Consequence:** the production native gauge (`vesolve/instructions/native_gauge.rs`) already implements **Candidate A** below. The legacy fee-weighted `GaugeStake` is **Candidate D**. No existing code implements a productivity gate (C) or a range-width floor (B).

---

## 3. Candidates

Notation: `L_i` position liquidity, `R_i(t)=1` iff `tick_lo ≤ tick(t) < tick_hi`, `E` epoch gauge budget for the pool, `rate = E/604800`.

### Candidate A — In-range liquidity-seconds (DEX-native)

```
w_i = ∫ L_i · R_i(t) dt                      (position weight)
earned_i = Σ_t  rate · [Pool.L(t) > 0] · L_i R_i(t) / Pool.L(t)
```

- **State:** none beyond what exists (pool `liquidity`, `reward_infos[0]`, tick `reward_growths_outside`, position checkpoint).
- **Checkpoint events:** every swap/tick crossing, liquidity change, schedule change (all already call `next_solve_reward_infos`).
- **Compute/storage:** zero incremental. Already shipped.
- **Rounding:** Q64.64 growth, floors on every claim (see §5.4): total paid ≤ budget, dust stays in vault.
- **R2/R3:** satisfied for the *accrual* (the `liquidity == 0` skip), but **not for minting** — see §7 finding F1.
- **Weakness:** (a) idle in-range liquidity earns with zero trading (R4/R7 read strictly); (b) micro-range advantage: `L ∝ capital / width`, so a one-tick position holds enormous `L` per dollar.

### Candidate B — A + canonical-pool range-width floor

Same weight as A. Added rule: gauge-eligible (canonical) pools only admit positions with `tick_hi − tick_lo ≥ W_min` ticks (**PROPOSED:** realised through tick spacing of the canonical pool, e.g. spacing 64 ≈ 0.64%).

- **State:** none at runtime. Enforcement in `open_position*` / `reset_position_range` for pools flagged canonical, plus a grandfathering rule for pre-existing narrower positions (they stay valid but weigh as `min(L, L_at_W_min)` — requires care; simplest is *pool choice*: Admin only designates a canonical pool whose spacing ≥ the floor, which A3's "one canonical pool per pair" already gives Admin).
- **Compute/storage:** one compare at position open. Negligible.
- **Effect (sim, spacing 64):** micro-range bot share falls from 50.9% → 9.2% against an honest ±5% LP with 1% of its capital (X1).
- **Weakness:** does not remove the capital-efficiency premium of the narrowest allowed range — by design (R5).

### Candidate C — A gated by a lagged pool-activity eligibility signal

```
gate(h)  = 1  iff  fee_yield(h-1) ≥ φ          (previous whole hour; lag makes it decidable at accrual time)
fee_yield(h) = Σ_{t in h} Δfee_growth_global(token, t)·… / in-range liquidity value   [oracle-free, scale-free]
w_i(t)   = gate(h(t)) · L_i R_i(t)
```

Fees only open/close a **pool-wide** switch per hour; they never scale an individual position's weight (satisfies R6). If the gate is closed the hour's emission is unearned (R2).

- **State (PROPOSED):** per-pool `bucket_hour`, `bucket_fee_growth_checkpoint_a/b`, `last_gate_open_hour` (~48 bytes in the pool's extension space or in `NativeGauge`).
- **Checkpoint events:** first swap/checkpoint in a new hour closes the previous bucket. If no checkpoint happens in an hour (no swaps ⇒ no fee growth ⇒ gate would be closed anyway), the gap hours are *closed by definition*. That makes the gate lazy and keeper-free.
- **Compute:** one extra branch + 2 u128 subtracts in the accrual path.
- **Oracle:** none. The threshold is a *yield* (fees per unit in-range liquidity per hour), so it is scale-free and avoids a manipulable price. It does implicitly depend on tick position through `L`'s value; use token-A fee growth per unit `L` normalised by the active range's sqrt-price span (Codex C2 to confirm the cheapest exact form).

> **Update (gate denominator, 2026-10-01).** The first implementation measured yield on the pool's *virtual depth* `2·L·√P`. Concentrated liquidity is leveraged (about 200x for a ±1% range, 30x for ±6%), so that asked a concentrated pool for 30-200x the volume of a full-range pool to reach the same "1 bp per hour", which defeats the point of rewarding tight useful liquidity. The gate now measures fee yield on the pool's **real capital**: `fee value in token B / (vault_b + vault_a·P)`, vault balances read at swap time, minus uncollected protocol fees. No ticks, no oracle. At the default 1 bp per hour this is about 88% APR on pool capital, so Admin should expect to tune `φ` per launch conditions (`set_gate_threshold`). Wash-trading cost is `φ·pool value` per hour, which scales with the pool's real size.

- **Effect (sim):** X10 (no honest volume + one dust trade) → 0 earned. X10b (attacker wash-trades enough to open the gate every hour) → still earns, but pays `168 · φ · V` per week in fees to voters.
- **Weakness:** a quiet-but-legitimate pool loses emissions in dead hours. This matches R2 and the Part C statement that dead capital earns zero, but it must be an explicit economic choice (§6, Decision D1).

### Candidate D — Hybrid in-range L-seconds + fee-share (legacy GaugeStake)

```
w_i = ½ · (L-seconds_i / Σ L-seconds) + ½ · (fees generated by i / Σ fees)
```

- **State:** per-position `GaugeStake` account (weight, paid-index, `last_fee_owed_{a,b}`), pool-level total weight; positions must register/stake.
- **Compute:** one extra account per position; `sync_stake` per position per update; the fee-owed *decrease on collect* is un-observable (code already under-counts, `emission.rs:230`).
- **Violates R6:** fees directly buy weight.
- **Effect (sim, X4b):** a 60-second burst of 100× capital plus 1000× wash volume captures 4.5% of a week's emission (vs 0.01% under A/B/C).
- **Verdict:** rejected. It is the design the native gauge was built to replace.

### Rejected — Candidate E (per-position width-normalised weight `L·min(1, width/W_min)`)

Correct in theory but impractical: the DEX accumulator divides by `Pool.L`, a single scalar; a per-position multiplier would require per-tick weighted liquidity sums and a rewrite of swap/crossing accounting. Candidate B reaches ~the same protection with an admission rule.

---

## 4. Simulation results (normal)

Share of the pool's epoch budget; "unearned" is emission that is not earned. 60-s steps, random-walk price, tick spacing 1 (A, C, D) or 64 (B).

| Scenario | A | B | C | D |
|---|---|---|---|---|
| N1 single honest LP | 100% | 100% | 99.4%, 0.6% unearned¹ | 100% |
| N2 same capital, ±50% vs ±5% | 12.0 / **88.0** | 12.2 / **87.8** | 11.9 / 87.5 | 12.0 / 88.0 |
| N3 second LP joins at 50% | 75 / 25 | 75 / 25 | 74.4 / 25 | 75 / 25 |
| N4 liquidity only first 60% | 60% earned, 40% unearned | same | 59.4 / 40.6 | same |
| N5 votes, no liquidity | 100% unearned | same | same | same |
| N6 static ±0.32% LP drifts out | 14 / 86 | 2.3 / 97.7 | 13.4 / 86 | 14 / 86 |

¹ C loses the first hour of the epoch because the gate looks back one bucket (0.6% = 1/168). A approved (D4) variant carries the previous epoch's closing gate state over the boundary; Codex to cost.

All four satisfy R2, R3, R8, R9 (prospective join/leave) in normal conditions. The difference is entirely adversarial.

## 5. Simulation results (adversarial) and manipulation economics

### 5.1 Matrix (attacker share of the pool's weekly budget)

| Scenario | A | B | C | D |
|---|---|---|---|---|
| X1 micro-range re-centring bot, 1% of honest capital | **50.9%** | 9.2% | 50.6% | 50.9% |
| X2 flash liquidity, 100× capital, one 60 s step | 0.010% | 0.010% | 0.010% | 0.010% |
| X3 add/remove 1 step in 10 | 5.0% (= its time share) | 5.0% | 5.0% | 5.0% |
| X4 wash volume 10× honest, narrow range | 60.6% (**from range, not volume**) | 41.4% | 60.2% | 60.6% |
| X4b flash capital + 1000× wash burst | 0.010% | 0.010% | 0.010% | **4.5%** |
| X7 500 split positions vs 1, same capital | 50% (= its capital share) | 50% | 49.7% | 50% |
| X9 100× inactive (out of range) capital | 0% | 0% | 0% | 0% |
| X10 no volume, one dust trade | **100% earned** | 100% | **0%** | 100% |
| X10b no volume, attacker pays gate fees | 100% | 100% | 99.4% (pays) | 100% |

Caveats the simulator is deliberately generous about: the re-centring bot rebalances for free (no impermanent loss, no gas); flash liquidity pays no capital cost. Real attackers do worse, so these are upper bounds on attacker share.

### 5.2 Findings

1. **Micro-range is the dominant attack.** Because LPs earn no fees in an active gauge, range width is the only lever. Under A, $1k in one-spacing ranges out-earns $100k at ±5%. Width floor (B) is the cheapest fix and is the only candidate that moves X1 materially.
2. **Flash / one-step / rapid cycling are harmless** under any time-integrated weight: earnings scale with seconds in range, so cycling for 1 step in 10 earns 10% of the capital's full-time rate (5% of the pool).
3. **Splitting is neutral** under A–C: weight is additive in `L`, so N positions of capital/N equal one of capital. The only split effect is integer rounding (5.4).
4. **Wash trading buys nothing under A/B** — fees don't enter weight. Under C it buys only gate state and costs `fees` paid to voters. Under D it directly buys weight.
5. **Idle in-range liquidity earns under A/B** (X10). Whether that counts as "productive" is Decision D1.

### 5.3 Cost vs reward for the one attack C can still be paid to do (gate-farming)

Let `V` = attacker's in-range capital value, `φ` = gate yield per hour, `f` = fee rate of the pool, `S` = pool's weekly budget in USD at current SOLV3 price, `s` = attacker's share.

```
wash volume needed per hour = φ·V / f
fees paid per week          = 168 · φ · V          (to voters, or back to attacker if attacker owns the votes)
profit                      = s·S − 168·φ·V  (− IL/gas, ignored)
```

Worked example (**illustrative**, parameters PROPOSED not approved): φ = 1 bp/hour, V = $100k ⇒ fees ≈ $1,680/week. Unprofitable unless `s·S > $1,680`. For a 22%-vote pool with 286,000 SOLV3/week, the attack pays only if SOLV3 ≥ ~$0.006 and the attacker has ~100% of in-range depth (s≈1) — i.e. gate-farming only matters in thin, new pools, which is exactly where "one productive LP may receive 100%" is intended. The residual risk is that a voter-attacker recoups the fees. Mitigation is already in the frozen rules: voters are identified, public, and Admin controls gauge activation/removal (A3, A4).

### 5.4 Integer / rounding (Q64.64 accumulator)

`plw_sim.py` emulates `growth += dt·rate_x64 / L`, claim `= (Δgrowth · L_i) >> 64`, with 1 honest position and an attacker splitting into N:

| Attacker split | Checkpoint cadence | Dust never paid (of 1.2999999997e15 base units) |
|---|---|---|
| 1 | once | 2 |
| 500 | once | 101 |
| 500 | hourly | 33,601 (≈3.4e-5 SOLV3) |
| 1 | every second | 302,401 (≈3.0e-4 SOLV3) |

Rounding **always floors toward the vault**: the total paid never exceeds the budget, and splitting/frequent checkpointing only *loses* the checkpointer dust. There is no extraction path (`paid ≤ earned ≤ budget` holds). The `growth` addition is `wrapping_add` and the delta is computed with wrapping subtraction (consistent with `next_reward_growths_inside`); `checked_mul_div(...).unwrap_or(0)` means an overflow **halts** the stream rather than over-paying (fail-safe, but see F3).

---

## 6. Recommendation

**Recommend: A + B as the weight, with C as an optional pool-wide eligibility gate that Seth must explicitly switch on or off (Decision D1).**

- `weight_i = ∫ L_i·R_i dt` over the existing DEX accumulator (zero new compute), **plus** the range-width floor on canonical pools (B).
- Productivity (R4/R7 strict reading): C-gate. Without it, an LP that sits in range and attracts no volume still earns; with it, a pool must show fee yield ≥ φ in the previous hour for that hour's emission to be earned.
- Reject D (violates R6, flash+wash exploitable) and E (impractical).

### Decisions (APPROVED by Seth, 2026-10-01 — recommended option taken in every row)

| ID | Decision | Approved |
|---|---|---|
| **D1** | Does in-range liquidity with **zero trading** count as productive? | **APPROVED: No — C gate enabled.** The handoff says dead capital earns zero and a microscopic trade must not activate an epoch; A alone pays idle depth. The cost is that quiet hours earn nothing (R2 already says so). |
| D2 | Width floor `W_min` for gauge-eligible pools | **SUPERSEDED 2026-10-01 (Seth):** all fee tiers eligible (spacing ≥ 1) for stablecoin pairs; the earlier approved floor was spacing ≥ 64 (~0.64%) |
| D3 | Gate yield threshold φ and bucket length | **APPROVED:** 1 bp/hour on 1-hour buckets; admin-adjustable only with next-epoch effect (same pattern as Exit fee D3) |
| D4 | First-hour-of-epoch handling for C | **APPROVED:** carry previous epoch's closing gate state |

### Required cross-review before approval (Gate 3 → Codex)

1. C2: confirm per-hour gate bookkeeping fits in `NativeGauge` or the pool extension without a pool-account migration (the pool account is size-fixed).
2. C2: confirm the cheapest exact "fee yield per unit in-range liquidity" from `fee_growth_global_{a,b}` and `liquidity` with no oracle.
3. C2: cost of a `W_min` check at `open_position_with_token_extensions` and `reset_position_range`; policy for already-open narrow positions in a pool that becomes canonical.
4. Confirm `earned_total` can be tracked (F1) without adding a CPI from the DEX to vesolve.

## 7. Findings against the frozen rules found while modelling (for Gate 1 / Codex matrix)

These are **contradictions between current code and the frozen handoff**, discovered while reading the gauge path. Verified by reading source; not yet confirmed by Codex or tests.

| ID | Finding | Rule | Evidence |
|---|---|---|---|
| **F1** | `fund_native_gauge` **mints the entire gauge budget up front** into the pool vault. Zero-liquidity periods leave tokens unminted-in-spirit but *already minted*; leftover re-enters via `carry_amount`. That is minting before earning and carrying forward. | B4 "mint on claim; minted ≤ earned", B5 "not minted, not carried forward" | `native_gauge.rs:196` (`mint_to`), `carry_amount` at `:85,:101,:106-109,:192,:211` |
| F2 | 4% of every weekly emission goes to a developer wallet before gauge budgets are computed (`gauge_budget = total − 4%`). | B3/B4: emission goes entirely to LPs; no Admin-directed minting | `states/emission.rs:44-55`, `constants/ve.rs` `DEVELOPER_ALLOCATION_BPS` |
| F3 | Reward-growth overflow is swallowed (`unwrap_or(0)`): emissions silently stop for the interval but the vault still holds them. | E: never silently lose obligations | `solve_manager.rs:41-46` |
| F4 | Gauge **activation is immediate** (`configure_native_gauge(active=true)` flips `is_active` and sets protocol fee rate to 100% in the same instruction) — no `PENDING_ACTIVATION`/next-epoch step. | A3 | `native_gauge.rs:112-116` |
| F6 | `weekly_emission` is a 1e18 fixed-point power, not the B2 recurrence; verified to exceed it by a few base units from epoch 11 (1,712 of 5,001 epochs). | B2, INV minted ≤ scheduled | `states/emission.rs:8-42` |
| F5 | Voting cutoff is epoch end − 1 hour, not Wednesday 23:55 UTC (5 min). Epoch boundary is unix-week aligned, which *is* Thursday 00:00 UTC. | A5 | `vote.rs:8-12`, `constants/ve.rs` `VOTE_REVOCATION_DEADLINE`; `update_epoch.rs` |

F1 is the one that interacts with PLW: B4/B5 are only fully met if the stream is minted lazily or the unearned remainder is burned/never minted at epoch close. Proposed approaches for Codex C2 to cost (do not implement before approval):
(i) add a pool-level `unearned_x64` counter that `next_solve_reward_infos` increments on `liquidity == 0` intervals, and at epoch close burn exactly that amount from the vault; or
(ii) a permissionless `settle_gauge_epoch` that computes `minted − Σ earned` from that counter and burns the remainder.
Either keeps `minted_and_not_burned ≤ earned ≤ scheduled`.

*(The invariants document, `SOLVE3_FULL_LAUNCH_INVARIANTS.md`, carries the full requirement/state-machine view of these.)*
