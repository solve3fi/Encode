# Devnet Test Harness Plan (Handoff Part K Workstream 3, Part I)

**Authored by:** Claude, standing in for Codex at Seth's request (2026-10-01). **Design only; nothing was built or run.** Sandbox network policy currently blocks Devnet RPC, so no Devnet state was read.
**Goal:** a repeatable, evidence-producing harness that executes phases I1–I17 of the handoff, including the adversarial cases, against builds that implement the frozen rules, with STOP/GO gates (Gates 4–6).
**Inputs:** `SOLVE3_FULL_LAUNCH_PROTOCOL_SPEC_V1.md`, `…INVARIANTS.md`, `…THREAT_MODEL.md`, `CODEBASE_REQUIREMENTS_MATRIX.md`, `EXISTING_TEST_COVERAGE.md`.

## 1. Constraints this design has to respect

1. **Time.** Epochs are weekly and `initialize` requires `epoch_reset_time == WEEK` (`vesolve/instructions/initialize.rs:44`). Real Devnet cannot warp time. A full I1–I17 run in real time is multiple weeks.
2. **Many phases test features that do not exist yet** (pending activation/removal, pauses, upgrade timelock, whitelist, per-position votes, partial Exit, burn-unearned, activity gate). The harness must therefore be **tests-first**: write the phase as an expected-failing ("red") test against current code, and flip it to required once the feature lands.
3. **Safety.** The existing local scripts already assert loopback and a non-Devnet genesis hash before signing (`frontend:scripts/test-native-gauge-local.mjs`). Keep that rule and invert it for Devnet runs (see §7).
4. **Reproducibility.** Today's evidence is ad-hoc `verify-*.mjs` scripts with hard-coded paths (`D:/Projects/ve33-contracts/id.json`) and no retained artifacts. Replace with a parameterised runner that writes evidence JSON.
5. **Toolchain drift.** `ve33-contracts` pins Anchor 0.32.1; the frontend uses `@coral-xyz/anchor` 0.31.1 and `@solve33/sdk`. Pin one client library for the harness.

## 2. Three tiers

| Tier | Where | Time control | Used for | Phases |
|---|---|---|---|---|
| **T1 Simulated** | in-process SVM (LiteSVM or `solana-program-test`), programs loaded from built `.so` | `set_clock` / warp slots freely | all negative/adversarial cases, property/fuzz tests, rounding, long horizons (5,000 epochs), emission reconciliation, every invariant | I3–I15, I17, I10 adversarial, most of I6 and I8 |
| **T2 Local validator with Devnet fixtures** | `solana-test-validator` on loopback with cloned Devnet accounts (pattern exists in `test-native-gauge-local.mjs --print-clones`) | validator `--warp-slot`; fixtures cloned at a chosen state | upgrade/migration of **real** Devnet state, pool/gauge fixtures, keeper behaviour | I12–I13 migration, I9 against real pools |
| **T3 Devnet** | real Devnet, **fast-epoch test build** | build-time epoch length (§3) | end-to-end evidence with real programs/RPC/Token-2022 mints, tx signatures, explorer-verifiable | I1–I17 at reduced scale, final rehearsal |

Rule: **every phase runs in T1 first.** T3 repeats only the happy path and a selected attack set, because it is slow and public.

## 3. Epoch/time control

- **T1/T2:** clock override. All time-dependent assertions use a `Clock` helper (`warpTo(epochStart + offset)`).
- **T3 fast epochs:** add a Cargo feature (e.g. `fast-epochs`) that sets `WEEK` to a short period (proposal: 20 minutes; cutoff = last 5/10080 of the epoch scaled, i.e. cutoff offset proportional, minimum 20 s). Requirements:
  - the feature MUST NOT be enabled in release/mainnet builds; CI builds both and compares program hashes against a release manifest;
  - `initialize` and `update_epoch` read the constant, so no other code path changes;
  - evidence records the program hash and the feature flag so a reader can tell fast vs real builds.
- **Final real-time rehearsal (T3, release build):** one full weekly epoch on Devnet with Thursday 00:00 UTC rollover and a Wednesday 23:55 cutoff, run once before Gate 5 sign-off to cover A5/A6 exactly as specified.
- Productive-liquidity hourly buckets (C **[D]**) scale with the fast-epoch build (bucket = epoch/168) so T3 exercises the gate.

## 4. Fixtures and wallets

Deterministic keypairs derived from a seed phrase in an **ignored** local file (never committed; no key material in repo or docs). Roles:

| Role | Purpose |
|---|---|
| `admin` | the single Admin wallet (F1), plus `admin2` to test transfer |
| `upgradeAuth` | upgrade authority for timelock tests (I15) |
| `treasury` | Treasury destination; asserts all Treasury receipts (OPEN-3 decides exact account) |
| `devWallet` | 4% dev allocation recipient ([D]) |
| `alloc_treasury`, `alloc_team`, `alloc_advisors` | protocol allocation wallets with permanent locks (A10) |
| `presale1..N` | presale claimants (I2) |
| `lp_honest`, `lp_narrow`, `lp_bot`, `lp_sybil[1..500]` | PLW normal and attacker LPs |
| `voter_a..d`, `bob_recipient` | voting, transfer attack recipient (I6) |
| `briber`, `trader_wash` | bribes (I8), wash/flash trading (I10) |
| `keeper` | permissionless crank caller (epoch, sweep, settle) |

Mints: `SOLV3` (real program-controlled mint in T3; T1 loads it with the production authority model), `SOL` (wSOL), `USDC-test`, `CHAT-test` (unlisted project token), and **hostile mints**: Token-2022 with transfer fee, with transfer hook, frozen account, permanent delegate, closed-ATA recipient, and a mint with mint authority retained (to test whitelist and failure injection, T12–T13).
Pools (each with a canonical-pair map): SOLV3/SOL, SOLV3/USDC, CHAT/SOL (unlisted → listed → gauged), plus a duplicate same-pair pool at another fee tier to prove canonical uniqueness (I3, I13).

## 5. Runner architecture

```
harness/
  config/       cluster allowlist, program ids, fast-epoch manifest, tier selection
  fixtures/     wallet derivation, mint/pool/gauge builders, state snapshots
  phases/       one module per phase: I1_genesis … I17_failure
  invariants/   pure functions over (state snapshot, event log) -> violations
  adversarial/  PLW and vote-transfer attack generators
  evidence/     writer, hasher, report builder
  run.ts        CLI:  run --tier t1|t2|t3 --phase I6 [--attack all] [--evidence out/]
```

Each phase is a table of steps `{ setup, action, expect }` with the handoff's required headings:
`starting state` · `action` · `expected program state` · `expected balances` · `expected rewards` · `expected events` · `forbidden outcomes` · `STOP/GO`.
**Forbidden outcomes are executable:** each attack step asserts the transaction **fails with a specific error code** and that a before/after snapshot diff is empty.

## 6. Snapshots, events, invariant checking

- **Balance/state snapshot** before and after every action: all token accounts of interest, SOL lamports of Protocol/Treasury/dev, pool vaults, `Epoch`, `Protocol`, `NativeGauge`, `Gauge`, per-position vote state, reward obligations. Stored as canonical JSON with account data hash.
- **Event capture:** decode Anchor events from transaction logs (`Program data:` lines) with the IDL; assert exact sequence per step (F4 list), no unexpected events.
- **Invariant engine** runs after **every** step (not only at phase end) and fails the run on first violation: INV-S1/S2 (supply reconciliation: `totalSupply = genesis + Σ minted − Σ burned`, `minted_net ≤ 1.3M·0.98ⁿ`), INV-A1 (`earned = claimed + outstanding` per obligation), INV-F5 (fee splits sum exactly), INV-V1 (Σ epoch weights = Σ position allocations), INV-G1 (≤ 1 canonical gauge per pair), INV-S3 (recurrence vs reference).
- **Reference model:** a pure TypeScript/Python model of the frozen rules (emission recurrence, PLW weight, fee routing by state). Phase expectations come from the model; program results are compared to it, so tests do not hard-code numbers copied from the program.

## 7. Safety rules

1. Cluster allowlist by **genesis hash**, not URL. T1/T2 refuse to run if the genesis hash is Devnet/Mainnet; T3 refuses unless it is Devnet. **Mainnet is never in the allowlist.**
2. No secrets in repo; keys loaded from an ignored path or env; evidence redacts everything except public keys and signatures.
3. T3 runs require an explicit `--confirm-devnet` and print the program hashes and authority set before the first signed transaction.
4. Rate limit and retry policy against public RPC; if blocked, the run aborts rather than partially executing a phase.
5. Never reuse production keeper config; the fee-policy keeper (frontend doc 2026-09-14) must be **stopped** during harness runs or it will reset pool fee rates the phases set.

## 8. Failure injection (I17, T12–T13)

| Injection | Mechanism (T1/T3) |
|---|---|
| failed reward transfer | recipient ATA closed/uninitialised; frozen destination; frozen vault |
| reward-token failure | token paused via per-token pause (A12), Token-2022 hook that rejects, mint authority revokes after deposit |
| duplicate retry / replay | resubmit the same claim, same blockhash and new blockhash; two claims in one slot |
| paused subsystem | enable each independent pause then claim/vote/bribe/exit |
| ownership change between accrual and claim | transfer position/NFT, then claim as old and new owner |
| gauge removal / delist / migration between accrual and claim | lifecycle transitions then claim |
| upgrade between accrual and claim | upgrade program (T2/T3) then claim |
| RPC faults | drop/reorder confirmation to prove idempotent client retries |

Each ends with the invariant engine reconciling `earned = claimed + outstanding` (INV-A1).

## 9. Evidence artifacts

Per run: `evidence/<date>-<tier>-<gitsha>/`
- `manifest.json`: tier, cluster genesis hash, program ids and **program data hashes**, fast-epoch flag, git SHAs of both repos, tool versions, wallet public keys.
- `phase-<id>.json`: ordered steps; per step: action, tx signature(s), compute units, error code if expected, **pre/post snapshots (hash + diff)**, decoded events, invariant results, STOP/GO decision.
- `balances.csv`: every tracked account before/after.
- `report.md`: human summary per phase with pass/fail, explorer links (T3), and the list of accepted residual risks (Gate 7).
- Reproducibility check: re-running a T1 phase with the same seed MUST produce identical snapshot hashes.

## 10. Phase plan and gating

| Phase | First tier | Depends on (feature) | Initial status against current code |
|---|---|---|---|
| I1 genesis (100M reconciliation, authorities, mint restrictions) | T1/T3 | read-back of mint authority (matrix B1) | **expected FAIL** if `mint_tokens` admin mint is live |
| I2 claims (presale, replay, no deadline) | T1 | presale program (not in repos) | blocked: need presale source |
| I3 pools / 95-5 / listing / duplicates | T1 | on-chain listing + state routing (A2/A3) | expected FAIL (100/0 and 20/80 policy) |
| I4 gauge activation next epoch | T1 | pending activation (F4) | expected FAIL |
| I5 voting (split, reset, cutoff 23:55, rollover, zero vote) | T1 | cutoff change, reset instruction | partial; cutoff test FAILS |
| I6 vote-transfer attacks | T1 | position-keyed votes (A8) | expected FAIL / N/A until transfer enabled |
| I7 protocol auto-vote | T1 | allocation auto-vote (A10) | blocked |
| I8 bribes | T1 | whitelist, pinned epoch, cutoff | expected FAIL (T11, T12) |
| I9 emissions (1.3M, decay, round-down, zero-vote, partial weights, mint reconciliation) | T1 | recurrence fix, burn-unearned | FAIL at epoch ≥ 11; mint reconciliation FAIL |
| I10 PLW normal + adversarial | T1 | range floor + gate (blocked on Gate 3 cost) | blocked |
| I11–I13 removal / delist / migration | T1 then T2 | removal/pair-canonical (A4) | blocked |
| I14 pauses | T1 | F2 | blocked (absent) |
| I15 upgrades | T2/T3 | F3 | blocked (absent; authority holder UNKNOWN) |
| I16 Exit (disabled through Week 4; later oracle) | T1 | disable flag (matrix D2) | **expected FAIL now**; first phase to flip green |
| I17 failure injection | T1 then T3 | per-asset claim / obligation ledger | expected FAIL |

**STOP/GO:** a phase is GO only if (a) all required steps pass, (b) all forbidden-outcome steps fail safely with the expected error, (c) the invariant engine reports zero violations, (d) evidence is written and hashed. Gate 5 = all happy-path phases GO on T3; Gate 6 = all adversarial steps GO on T1 and the selected set on T3.

## 11. Build order for the harness

1. T1 skeleton: SVM wrapper, clock control, wallet/mint/pool builders, snapshot + event decoder + invariant engine, reference model (emission recurrence first).
2. I16 (Exit disabled) and I1 (genesis) as the first red→green pair; wire a CI job running T1.
3. Port the existing local native-gauge scripts into T1/T2 (I9, I10 normal).
4. Fast-epoch feature and the T3 runner with evidence writer; one T3 smoke run (create lock, vote, advance epoch).
5. Add phases in the implementation order of the matrix; flip red tests as features land.

## 12. Open questions for Seth

1. May the harness add a `fast-epochs` build feature to the programs (test-only, excluded from release, hash-checked in CI)? Without it, T3 needs real weeks.
2. Is the Devnet deployment allowed to be **upgraded to test builds**, or should T3 use a fresh set of program IDs and a fresh SOLV3 mint (my recommendation, to avoid disturbing existing Devnet state and the keeper)?
3. Who holds the Devnet upgrade authority and Admin keys for harness runs (never me in cleartext)? The matrix could not read them (RPC blocked).
