#!/usr/bin/env python3
"""Productive Liquidity Weight (PLW) candidate simulator.

Companion to docs/full-launch/PRODUCTIVE_LIQUIDITY_WEIGHT_MODEL.md.
Deterministic (fixed seed). Run: python3 plw_sim.py

Models one canonical gauge pool for one epoch at 60 s resolution. Every
candidate distributes the same per-second gauge budget; what differs is
which positions carry weight. All amounts are expressed as a fraction of the
pool's epoch emission budget (1.0 = the whole N+1 gauge budget), so results
are independent of the SOLV3 price and the gauge's vote share.

Simplifications (each is generous to the attacker, never to honest LPs):
  * re-centering bots rebalance at zero swap cost / zero impermanent loss;
  * flash liquidity pays no capital cost;
  * one swap of honest volume per step, at the step's closing price.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

EPOCH = 604_800
DT = 60
STEPS = EPOCH // DT
Q64 = 1 << 64
SEED = 7


# ----------------------------------------------------------------------------
# Concentrated-liquidity maths (Whirlpool / Uniswap v3 conventions)
# ----------------------------------------------------------------------------

def sqrt_price(tick: float) -> float:
    return 1.0001 ** (tick / 2)


def value_per_liquidity(lo: int, hi: int, tick: float) -> float:
    """Value (in token B) of one unit of liquidity on [lo, hi) at `tick`."""
    sa, sb, s = sqrt_price(lo), sqrt_price(hi), sqrt_price(tick)
    if s <= sa:
        return (1 / sa - 1 / sb) * s * s
    if s >= sb:
        return sb - sa
    return (1 / s - 1 / sb) * s * s + (s - sa)


def liquidity_for_capital(capital: float, lo: int, hi: int, tick: float) -> float:
    return capital / value_per_liquidity(lo, hi, tick)


def price_path(seed: int = SEED, sigma_ticks: float = 3.0) -> list[float]:
    rng = random.Random(seed)
    tick, path = 0.0, []
    for _ in range(STEPS):
        tick += rng.gauss(0, sigma_ticks)
        path.append(tick)
    return path


# ----------------------------------------------------------------------------
# Positions and strategies
# ----------------------------------------------------------------------------

@dataclass
class Position:
    owner: str
    capital: float
    width: int                 # ticks
    start: int = 0             # step the position is added
    end: int = STEPS           # step the position is removed (exclusive)
    recenter: bool = False     # bot that re-centres whenever out of range
    center: float | None = None
    lo: int = 0
    hi: int = 0
    liquidity: float = 0.0
    # accumulated outputs
    emission: float = 0.0
    fees: float = 0.0

    def place(self, tick: float, spacing: int) -> None:
        width = max(self.width, spacing)
        width = int(math.ceil(width / spacing) * spacing)
        c = self.center if (self.center is not None and not self.recenter) else tick
        lo = int(math.floor((c - width / 2) / spacing) * spacing)
        self.lo, self.hi = lo, lo + width
        self.liquidity = liquidity_for_capital(self.capital, self.lo, self.hi, tick)

    def live(self, step: int) -> bool:
        return self.start <= step < self.end

    def in_range(self, tick: float) -> bool:
        return self.lo <= tick < self.hi


# ----------------------------------------------------------------------------
# Candidates
# ----------------------------------------------------------------------------
# Each candidate receives the list of live positions at a step plus the step's
# honest fee volume and returns {position index: weight}. Budget for the step
# is distributed pro rata; if total weight is zero the step's budget is
# unearned (never minted).

def cand_a(live, tick, step, ctx):
    """A: in-range liquidity-seconds (the DEX-native reward accumulator)."""
    return {i: p.liquidity for i, p in live if p.in_range(tick)}


def cand_b(live, tick, step, ctx):
    """B: A, but the canonical gauge pool enforces a minimum range width.

    Width enforcement happens at placement (tick spacing), so the weight rule
    is identical to A; the difference is visible through ctx['spacing'].
    """
    return cand_a(live, tick, step, ctx)


def cand_c(live, tick, step, ctx):
    """C: A gated by pool activity in hourly buckets.

    A one-hour bucket is 'productive' only if honest+wash fees in the
    *previous* hour reached F_MIN (fraction of a reference hourly fee). The
    lag makes the gate decidable on-chain at accrual time.
    """
    hour = step * DT // 3600
    if hour == 0 or ctx['hour_fees'].get(hour - 1, 0.0) < ctx['f_min']:
        return {}
    return cand_a(live, tick, step, ctx)


def cand_c_naive(live, tick, step, ctx):
    """C-naive: position earns for a whole checkpoint interval if its own fee
    growth advanced at all during that interval. Accrual is computed
    retroactively at the position's checkpoint (here: once per epoch), which is
    exactly the shape a per-position check on Solana would have."""
    return cand_a(live, tick, step, ctx)  # weights resolved post hoc, see run()


def cand_d(live, tick, step, ctx):
    """D: hybrid 50% in-range L-seconds + 50% share of fees the position
    generated over the epoch (the legacy GaugeStake isqrt(fee_a*fee_b) family).
    Resolved post hoc in run() because fee share is only known at checkpoint."""
    return cand_a(live, tick, step, ctx)


CANDIDATES = {"A": cand_a, "B": cand_b, "C": cand_c, "C-naive": cand_c_naive, "D": cand_d}


# ----------------------------------------------------------------------------
# Runner
# ----------------------------------------------------------------------------

@dataclass
class Scenario:
    name: str
    positions: list[Position]
    honest_volume: float = 1.0       # fee units per step when any L is in range
    wash: dict = field(default_factory=dict)   # owner -> fee units per step (D/C)
    micro_trade_steps: tuple = ()     # steps where a dust trade happens
    wash_steps: tuple | None = None   # restrict wash volume to these steps
    honest_volume_steps: tuple | None = None  # restrict honest volume to steps
    f_min: float = 30.0               # C gate: fee units per hour


def run(scn: Scenario, cand: str, spacing: int, path: list[float]):
    positions = [Position(**{k: v for k, v in p.__dict__.items()
                             if k in ('owner', 'capital', 'width', 'start', 'end', 'recenter', 'center')})
                 for p in scn.positions]
    for p in positions:
        p.place(path[max(p.start, 0)], spacing)
    per_step = 1.0 / STEPS
    unearned = 0.0
    hour_fees: dict[int, float] = {}
    # C-naive bookkeeping: L-seconds earned and whether fee growth advanced
    naive_lsec = [0.0] * len(positions)
    naive_active = [False] * len(positions)
    naive_steps_with_l = 0
    fn = CANDIDATES[cand]
    for step in range(STEPS):
        tick = path[step]
        live = [(i, p) for i, p in enumerate(positions) if p.live(step)]
        for _, p in live:
            if p.recenter and not p.in_range(tick):
                p.place(tick, spacing)
        in_rng = [(i, p) for i, p in live if p.in_range(tick)]
        tot_l = sum(p.liquidity for _, p in in_rng)
        # fees: honest volume + wash volume, attributed to in-range L pro rata
        vol = 0.0
        if scn.honest_volume_steps is None or step in scn.honest_volume_steps:
            vol += scn.honest_volume
        if scn.wash_steps is None or step in scn.wash_steps:
            vol += sum(scn.wash.values())
        if step in scn.micro_trade_steps:
            vol += 1e-9
        step_fee_by_pos = {}
        if tot_l and vol:
            for i, p in in_rng:
                f = vol * p.liquidity / tot_l
                p.fees += f
                step_fee_by_pos[i] = f
                naive_active[i] = True
        hour = step * DT // 3600
        hour_fees[hour] = hour_fees.get(hour, 0.0) + (vol if tot_l else 0.0)
        ctx = {'hour_fees': hour_fees, 'f_min': scn.f_min, 'spacing': spacing,
               'step_fee_by_pos': step_fee_by_pos}
        weights = fn(live, tick, step, ctx)
        if cand in ('C-naive', 'D'):
            if tot_l:
                naive_steps_with_l += 1
                for i, p in in_rng:
                    naive_lsec[i] += p.liquidity / tot_l
            else:
                unearned += per_step
            continue
        tot_w = sum(weights.values())
        if not tot_w:
            unearned += per_step
            continue
        for i, w in weights.items():
            positions[i].emission += per_step * w / tot_w
    if cand == 'D':
        tot_f = sum(p.fees for p in positions)
        earnable = 1.0 - unearned
        for i, p in enumerate(positions):
            p.emission = 0.5 * naive_lsec[i] * per_step + (0.5 * earnable * p.fees / tot_f if tot_f else 0.5 * naive_lsec[i] * per_step)
    if cand == 'C-naive':
        for i, p in enumerate(positions):
            share = naive_lsec[i] * per_step
            if naive_active[i]:
                p.emission = share
            else:
                unearned += share
    by_owner: dict[str, float] = {}
    for p in positions:
        by_owner[p.owner] = by_owner.get(p.owner, 0.0) + p.emission
    return by_owner, unearned


# ----------------------------------------------------------------------------
# Integer accumulator (Q64.64) — rounding / split / sybil check
# ----------------------------------------------------------------------------

def integer_split_check(n_split: int, rate_per_sec: int = 2_149_470_899, seconds: int = EPOCH,
                        honest_l: int = 10**12, attacker_l: int = 10**12, checkpoint_every: int = 1):
    """Emulates next_solve_reward_infos + position owed computation.

    rate_per_sec ~ 1.3M SOLV3 (9 dp) / week. Returns (honest_owed,
    attacker_owed_total, emitted_budget). Attacker splits its liquidity into
    n_split equal positions and checkpoints every `checkpoint_every` seconds
    to maximise per-checkpoint rounding.
    """
    rate_x64 = (rate_per_sec * Q64)
    total_l = honest_l + attacker_l
    piece = attacker_l // n_split
    attacker_l_eff = piece * n_split
    total_l = honest_l + attacker_l_eff
    growth = 0
    ck_h = 0
    ck_a = [0] * n_split
    owed_h = 0
    owed_a = 0
    t = 0
    while t < seconds:
        dt = min(checkpoint_every, seconds - t)
        growth = (growth + (dt * rate_x64) // total_l) % (1 << 128)
        t += dt
        for j in range(n_split):
            owed_a += ((growth - ck_a[j]) * piece) >> 64
            ck_a[j] = growth
        if checkpoint_every >= seconds or t == seconds:
            owed_h += ((growth - ck_h) * honest_l) >> 64
            ck_h = growth
    return owed_h, owed_a, rate_per_sec * seconds


# ----------------------------------------------------------------------------
# Scenarios
# ----------------------------------------------------------------------------

def scenarios() -> list[Scenario]:
    S = []
    S.append(Scenario("N1 single honest LP (+/-5%)", [Position("honest", 100_000, 1000)]))
    S.append(Scenario("N2 same capital: wide +/-50% vs medium +/-5%",
                      [Position("wide", 100_000, 8000), Position("medium", 100_000, 1000)]))
    S.append(Scenario("N3 second LP joins at 50% of epoch",
                      [Position("early", 100_000, 1000), Position("late", 100_000, 1000, start=STEPS // 2)]))
    S.append(Scenario("N4 liquidity only for first 60% of epoch",
                      [Position("lp", 100_000, 1000, end=int(STEPS * 0.6))]))
    S.append(Scenario("N5 votes but no liquidity", []))
    S.append(Scenario("N6 static narrow LP drifts out of range",
                      [Position("static_narrow", 100_000, 64, center=0.0), Position("wide", 100_000, 4000)]))
    # adversarial
    S.append(Scenario("X1 micro range: 1-spacing bot re-centres vs honest +/-5%",
                      [Position("honest", 100_000, 1000), Position("bot", 1_000, 1, recenter=True)]))
    S.append(Scenario("X2 flash liquidity: 100x capital for one 60 s step",
                      [Position("honest", 100_000, 1000), Position("flash", 10_000_000, 1000, start=5000, end=5001)]))
    S.append(Scenario("X3 rapid add/remove: in for 1 step of every 10",
                      [Position("honest", 100_000, 1000)] +
                      [Position("cycler", 100_000, 1000, start=s, end=s + 1) for s in range(0, STEPS, 10)]))
    S.append(Scenario("X4 wash trading: attacker 10x honest volume, tight range",
                      [Position("honest", 100_000, 1000), Position("washer", 10_000, 64, recenter=True)],
                      wash={"washer": 10.0}))
    S.append(Scenario("X4b flash 100x capital + 1000x wash burst in one 60 s step",
                      [Position("honest", 100_000, 1000), Position("flashwash", 10_000_000, 64, start=5000, end=5001)],
                      wash={"flashwash": 1000.0}, wash_steps=(5000,)))
    S.append(Scenario("X7 split: attacker 500 positions vs 1 (same total capital)",
                      [Position("honest", 100_000, 1000)] + [Position("splitter", 200, 1000) for _ in range(500)]))
    S.append(Scenario("X9 huge inactive liquidity (100x, out of range)",
                      [Position("honest", 100_000, 1000), Position("whale_oor", 10_000_000, 1000, center=5000.0)]))
    S.append(Scenario("X10 no honest volume, dust trade once per epoch",
                      [Position("lp", 100_000, 1000)], honest_volume=0.0, micro_trade_steps=(10,)))
    S.append(Scenario("X10b no honest volume, attacker pays F_min every hour",
                      [Position("lp", 100_000, 1000)], honest_volume=0.0, wash={"lp": 0.5}))
    return S


def main() -> None:
    path = price_path()
    print(f"price path: {STEPS} steps, final tick {path[-1]:.0f}, "
          f"range [{min(path):.0f}, {max(path):.0f}]")
    print()
    for spacing_label, spacing in (("tick_spacing=1", 1), ("tick_spacing=64 (B floor)", 64)):
        print(f"=== {spacing_label} ===")
        for scn in scenarios():
            row = [scn.name]
            for cand in ("A", "B", "C", "C-naive", "D"):
                if cand == 'B' and spacing == 1:
                    continue
                if cand != 'B' and spacing == 64:
                    continue
                by_owner, unearned = run(scn, cand, spacing, path)
                parts = ", ".join(f"{o}={v:.4g}" for o, v in sorted(by_owner.items()))
                row.append(f"  {cand:7s} {parts}  unearned={unearned:.4g}")
            print("\n".join(row))
        print()
    print("=== integer accumulator rounding (Q64.64) ===")
    for n, every in ((1, 604_800), (500, 604_800), (500, 3_600), (1, 1)):
        h, a, budget = integer_split_check(n, checkpoint_every=every)
        print(f"split={n:4d} checkpoint_every={every:7d}s honest={h} attacker={a} "
              f"sum={h + a} budget={budget} dust_unminted={budget - h - a}")


if __name__ == "__main__":
    main()
