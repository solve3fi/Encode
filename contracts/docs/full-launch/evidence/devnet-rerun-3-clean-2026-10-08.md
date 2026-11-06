# Devnet rehearsal 3: clean Apache DEX + current vesolve (fast epochs), 2026-10-08

Fresh deployment, separate from the live solve3.fi devnet programs. Branch `rehearsal3/clean-fast` (from `deploy/clean-dex` b754a53, IDs changed only).

| Item | Value |
|---|---|
| vesolve | `DnpdMXtWdERg6kvW8ddqS8hzN6Vt7t4nDdcS1FegTH4o` |
| solve (clean, Apache-2.0) | `B9tWsDv9ysguBGCasWCLA8VNUEPeSE6KKSyx72X8M8XD` |
| token | `JArjex7KZmVrx8WkNDydMUPqEX5tMjgUMVw3NBZhiQaw` |
| SOLV3 mint | `JBTT33wUMH54SwSATet5mi6oqVvGHT6SCMZcVKdvfsdd` |
| Treasury | throwaway rehearsal key `FwkUtcGPRe1kfXRYGxXTxngaAo4zEPDkX9PmC3HEXHDt` |
| Timelock PDA | `8mc3QJYfZ2wkCjy6LjuP4FrrXZCLMwXWK7e24uv4ZLhR` |
| Epoch length | 20 minutes (fast-epochs build) |

## Phase 1: deploy, genesis, handover, readback
- Built token (default) + solve/vesolve (`fast-epochs`); fast marker present, live vesolve ID absent. PASS
- Deployed all three, genesis (100M SOLV3 to Treasury), test mints, DEX config, 2 pools, 2 gauges scheduled. PASS
- Handed all three programs to the timelock PDA. PASS
- readback.mjs: all checks PASS (timelock authority x3, mint authority = Protocol PDA, admin, treasury, nothing paused).

## Phase 2: scenarios (epoch 1-2)
- Epoch roll 0 -> 1, `configure_native_gauge(true)` for both gauges. PASS
- fund, locks (alice 2M, bob 400k x2, carol 800k), votes, bribes. PASS
- LP: 4 positions opened after mirroring the plan's tick ranges (pools are price-inverted because tUSDC sorts before SOLV3/tSOL under the new mints). PASS
- Epoch 2 emissions: Emission(2) = 1,274,000 SOLV3 (1.3M x 0.98). 96% to gauges = 1,223,040, split SOLV3/tUSDC 774,592 (63.33%) and tSOL/tUSDC 448,448 (36.67%), exactly the vote weights (2.28M vs 1.32M of 3.6M). Developer 4% = 50,960. Supply 101,274,000. PASS
- Bribe claims for epoch 1 refused with `VotingRewardsNotClaimableYet` while in epoch 2: correct (rewards earned in epoch N unlock when N+2 begins). PASS
- Vote-transfer attacks (attacks.mjs): new owner re-vote / partial exit / split / merge of the transferred lock refused with `InvalidOwner`. Transfer of a voted lock refused with `LockHasActiveVotes` (known: stricter than spec A8, accepted earlier). Control exit refused with `ExitDisabled` (exit gate not open yet).

## Phase 3: epochs 3-5
- Epoch 3: Emission(3) = 1,248,520 (supply +1,248,520 exactly). 96% to gauges = 1,198,579.2, split 49.231% / 50.769%, exactly the recorded epoch-2 vote weights (alice's re-vote in attacks.mjs changed them; verified with check-split.mjs). PASS
- Epoch 3: bribe claims for epoch 1 exact for all 5 (alice, bob x2 locks, carol), unlocked at N+2. PASS
- Epoch 3: LP emission claims worked for all 4 positions. PASS
- Epoch 4 (no votes were cast in epoch 3): zero-vote emission. Developer 4% minted (48,941.984 = 4% of 1,223,549.6), both gauge fundings refused with `InvalidVotingPower`. PASS (same as run 1/2 behavior)
- Epoch 5: Emission(5) = 1,199,078.608 (supply +exact), epoch-4 vote weights 63.333% / 36.667%. PASS
- Exit opens at epoch 4 (`EXIT_DISABLED_UNTIL_EPOCH = 4`): exit fee change (non-admin refused, >100% refused, pending applies next epoch, second change replaces first, current fee holds in-epoch: 533,334 lamports for 1 SOLV3 at 40%) PASS; exit price (non-admin/zero refused, doubled price doubles the fee exactly) PASS; feechange2 in epoch 5 charges 20% = 266,667 PASS; 20 SOLV3 partial exit: liquid SOLV3 exact, fee 10,666,664 exact in protocol PDA, withdraw to non-Treasury refused (`InvalidTreasury`), Treasury received the fee exactly PASS; split + merge-back of an unvoted lock PASS; full exit of a lock (fee 5,333,332 exact, principal returned, account closed) PASS.
- Admin: gate threshold (non-admin refused, >10,000 ppm refused, cap accepted, restored) PASS; set_treasury (non-admin refused, old Treasury withdrawal refused after change, restored) PASS; bribe token: non-admin refused, paused claim refused (`BribeTokenPaused`, script expected `SystemPaused`), delisted deposit refused PASS.
- Allocation voter: non-admin register refused; admin registered lock 4 and voted 40% (weight = 40% of the lock, rest abstains); unregister PASS.
- Auto-vote enrollment is NOT admin-gated (ordinary lock owner enrolled and revoked). Still the open Auto-Vote gate decision.
- Gauge lifecycle on tSOL/tUSDC: request_gauge_removal moves it to status 3, effective epoch 6; new bribe refused (`GaugeInactive`); early deactivate refused (`GaugeTransitionNotDue`). Votes that include a pending-removal gauge are refused (`InvalidGauge`): DEV-8, unchanged.
- Pauses: voting / bribes / global are independent and reversible. PASS

## Phase 4: epochs 6-8
- Epoch 6: tSOL gauge removal falls due: deactivate (after routing fees) moves it to status 4 and drops protocol fee rate 10000 -> 500 (LPs keep 95%). Emission(6) = 1,175,097.03584 exact; removed gauge refused funding (`GaugeInactive`); SOLV3 gauge got 100% (epoch-5 votes 2.72M). PASS
- Epoch 6: voter fee claims for the epoch-4 vault: every payout exact against the true epoch-4 weights (e.g. alice 164,473,684 of 187.5M tUSDC = 2/2.28). Lock 3 refused (`InvalidGaugeVotes`, it never voted that gauge). PASS (the script's own expected-value constants were stale and print MISMATCH)
- Epoch 6-7: relist (status 1, generation 1, effective epoch 7); at epoch 7 `GaugeFeesMustBeSwept` blocks reactivation until the owed fees are swept; `sweep_ungauged_pool_fees` gives the Treasury exactly the owed amounts; reactivate -> status 2, rate back to 10000. PASS
- Pauses 2 (epoch 7, rerun with a claimable epoch-5 bribe and before epoch-7 emission): claims, exit, emissions, gauge-activation each refused with `SystemPaused`, independent and reversible. PASS. DEX swap pause: `SwapsPaused`, cleared. PASS
- Upgrade timelock: non-admin schedule and non-admin cancel refused; schedule gives executableAt = now + 86,400 s; early execute refused (`UpgradeNotDue`); cancel removes the schedule. PASS. Not run: the execute after the real 24 h (verified in runs 1 and 2, code unchanged). Cancel leaves the buffer (1.84 SOL) with the timelock.
- Admin transfer: non-admin propose refused, accept before proposal refused, nothing changes until the new wallet signs, a non-proposed wallet cannot accept, old admin refused after transfer, new admin works, admin restored. PASS
- Epoch 7 (no votes in epoch 6): zero-vote emission again, dev 4% minted (46,063.8 = 4% of 1,151,595.09), funding refused. PASS
- Epoch 8: Emission(8) = 1,128,563.19 exact; funded split 63.333% / 36.667% = epoch-7 votes. PASS
- Settle conservation: `settle_native_gauge_unearned` burned 675,681.4756 SOLV3 from supply; the two gauge vaults fell by 476,075.791 + 199,605.6846 = 675,681.4756. Exact. PASS
- LP claims are range-aware (same liquidity, narrow range out of range -> earns less). PASS
- Final readback (epoch 8): all PASS (timelock x3, mint authority, admin, Treasury, no transfer pending, nothing paused).
- Bot: 506 + 498 + 498 + 480 + 436 + 450 swaps, 0 failures across epochs 1-7.

## Findings for Seth
1. **Fees routed into a zero-vote epoch are stranded.** `route_pool_fees` has no vote-weight guard. Epoch 3 had no votes, yet fees were routed into its vault (205.5 tUSDC + 1,012.5 SOLV3 on SOLV3/tUSDC, 198 tUSDC + 1.179 tSOL on tSOL/tUSDC); no voter can claim them and there is no recovery instruction. The live epoch keeper routes every epoch regardless of votes. Fix: skip routing when the gauge has zero votes (fees roll into the next epoch), or add a program-side guard/carry-over.
2. **Ungauged fee rate mismatch.** The program sets 500 bps when a gauge is removed and `sweep_ungauged_pool_fees` only works at exactly 500, but the keeper's `gauge-fee-policy.mjs` reconciles ungauged pools to 0. If the keeper resets the rate before the owed fees are swept, the sweep is refused and reactivation stays blocked (`GaugeFeesMustBeSwept`). Workaround exists (collect via the DEX collect-fees authority and forward to the Treasury, as done for the live tSOL gauge). Decide which number is intended and align program, keeper and UI text.
3. **Auto-vote enrollment is not admin-gated.** Any lock owner can enroll/revoke. Open Auto-Vote gate decision.
4. **DEV-8 unchanged:** votes that include a PENDING_REMOVAL gauge are refused at once (`InvalidGauge`), whereas spec A4 says the gauge is normal through the effective epoch.
5. **Voted-lock transfer refused (`LockHasActiveVotes`)**, stricter than spec A8; accepted earlier.
6. **Admin UI:** Add Gauge lists pools whose token pair already has a gauge, then fails with `PairHasGauge`. Hide or label them.
7. Cancelling a scheduled upgrade leaves the buffer rent with the timelock until a later execute.

## Follow-up checks (2026-10-08)
- **Auto-vote 15% fee** (`autovote-fee.mjs`, epoch-5 trading fees, same gauge): control lock not enrolled (bob lock 3): gross A 27,573,529 / B 136,764,705,882, fee 0, paid in full. Enrolled lock (alice lock 1): user received exactly gross - floor(15%) (A 117,187,500, B 581,250,000,000). Enrolled lock (carol lock 4, 320k of 2.72M): gross A 22,058,823 / B 109,411,764,705 (= 187.5M and 930e9 x 320k/2.72M rounded down), fee A 3,308,823 / B 16,411,764,705 = floor(15%), user A 18,750,000 / B 93,000,000,000, fee paid into the Protocol PDA's token accounts. `withdraw_auto_vote_fees` moved exactly those amounts to the Admin's own accounts; the Treasury wallet received nothing (DEV-15). PASS
- **Live keeper outage found and fixed.** After the first two live gauges went active the epoch keeper exited 1 on every run ("Native gauge migration required before fee-policy writes"): its native-gauge detection required reward slot 2 to be all zero, but a managed pool keeps its activity-gate record there (DEV-16). Fixed in the keeper library, installed on the server; the next run finished successfully (fee policy applied to 8 pools, epoch 1, funding skipped for zero voting power). The same check in the UI (`nativeRewardEnd`) is fixed in the next site release.

- **Keeper auto-activation** (`activate-due.mjs` runs the keeper module against this deployment). Two gauges relisted and due in epoch 10: SOLV3/tUSDC at 0 bps (keeper-reset rate) with owed fees A 225,000 / B 1,125,000,000, and tSOL/tUSDC at 500 bps with owed A 225,000 / B 1,350,000. Dry run planned both (1 and 7 settlement instructions). Real run: both activated (status 2, rate 10000, owed counters 0). The Treasury received exactly the owed amounts (SOLV3 +1,125,000,000, tSOL +1,350,000; the shared tUSDC account +450,000 = 2 x 225,000). PASS

## Rehearsal 4: the live keeper drives the epochs (2026-10-08, epochs 10-14)
The real epoch keeper (frontend `scripts/finalize-devnet-epoch.mjs` + `scripts/lib`, IDs swapped by `make-keeper-stage.mjs`, nothing else) ran every 2 minutes (`keeper-loop.mjs`), as the server timer does: 21 runs, 0 failed (log: `rehearsal4-keeper-log.txt`). Users acted around it.
- Epoch 10 -> 11: keeper reconciled fee policy (default and the unvoted SOL pool 500 -> 0), rolled, initialized emission, skipped funding (no epoch-10 votes). PASS
- Epoch 11 (zero votes, fees owed on both gauges): two runs logged `route_skipped_no_votes`; fees stayed in the pools. PASS (DEV-10 guard)
- Add Gauge flow (create + schedule in one tx) on the SOL pool in epoch 11; at the roll to 12 the keeper switched it on by itself (`gauge_activated`). PASS
- Epoch 12: votes, bribes, carol's lock enrolled in auto-vote, tSOL removal requested. The next run routed the carried-over fees together with the new ones (16.5M / 18M tUSDC = 7.5M carried + new). PASS
- Roll to 13: final epoch-12 fees routed before the roll; `gauge_removal_due` announced (not completed); funding with the exact epoch-12 weights (0.92M / 1.68M of 2.6M); SOL gauge skipped (no votes). PASS
- Removal window: fees after the roll on the removal-due tSOL pool were NOT routed (no voters can exist, DEV-8) and were settled to the Treasury at deactivation (exact: A 4,500,000 B 18,000,000). The Admin UI's old "Complete removal" path would have routed them into a vault without voters (new DEV-17).
- The keeper funded the removal-due gauge for epoch 13; after removal its emission settled as unearned and was burned: supply -1,338,226.485219479 = vault decreases 857,247.392309176 + 480,979.092910303 (exact). Conservation PASS, but mint-then-burn (new DEV-18).
- The keeper itself produced the DEV-11 state: it reset the removed tSOL pool 500 -> 0 while 15,000 was owed. Relisted; at the roll to 14 the keeper activated it through the collect + forward path (`settledOwedFees: true`), owed 0, rate 10000. PASS
- Epoch 14 claims of epoch 12 (chain-derived expectations): 12/12 trading-fee checks and 13/13 bribe checks exact, including carol's enrolled lock paying exactly 15% on fees and bribes; wrong-owner claim refused. PASS
- Regression rerun: admin gate/treasury/exit price/admin transfer, vote-transfer attacks, pauses, split/merge, full exit, exit fee + Treasury-only withdrawal, DEX swap pause: all PASS (one exit measurement collided with the trading bot using the same wallet; rerun alone: exact).
- Final readback (epoch 14): all PASS.

## Resolution of the findings (2026-10-08, Seth: "fix them all with your recommendation")
| # | Finding | Resolution |
|---|---|---|
| 1 | Fees routed into a zero-vote epoch are stranded | Epoch keeper skips routing for gauges without votes in the epoch (`gaugeHasVotesInEpoch`, tested). Program follow-up: Treasury sweep of zero-vote vaults per spec 5.2 (DEV-10), next audited release. |
| 2 | Removed-gauge fee rate 500 (program) vs 0 (keeper) blocks reactivation | Admin "Switch on" settles owed fees at any rate: Treasury sweep at 500, DEX collect + forward at any other rate (`buildOwedFeeSettlement`, tested). Keeper unchanged (fee rate only, by design). Align the numbers next release (DEV-11). |
| 3 | Auto-vote enrollment not gated | Decision: keep open to all lock owners at the existing 15% fee (`AUTO_VOTE_FEE_BPS = 1,500`); spec 5.6 and DEV-12 record it; roadmap is a registry so any wallet can be the auto-voter. |
| 4 | DEV-8 (no new votes for a pending-removal gauge) | Keep the program's stricter rule; spec 4.5 amended. |
| 5 | Voted-lock transfer refused | Keep the stricter rule; spec 5.3 amended (DEV-1). |
| 6 | Add Gauge lists pools whose pair already has a gauge | Pools of an occupied pair are disabled and labelled (`pairHolderOf`, tested). |
| 7 | Cancel leaves the buffer with the timelock | Documented in the runbook (DEV-13). |
| 8 | (new) Auto-vote fee withdrawal is not Treasury-restricted | DEV-15, recommended program change next release. |
| 9 | (new) Keeper and UI native-gauge detection used the old layout | Fixed, DEV-16. |
| 10 | (rehearsal 4) Admin "Complete removal" routed owed fees into a vault without voters | UI fixed: route only when the gauge has votes this epoch, otherwise settle to the Treasury (DEV-17). |
| 11 | (rehearsal 4) Keeper funded a removal-due gauge (mint then burn) | Keeper skips funding gauges whose removal is due (DEV-18). |

## Script findings (rehearsal tooling, not contract defects)
- Swap now needs the `oracle` PDA (`["oracle", pool]`): bot.mjs, more.mjs, scenarios.mjs updated.
- LP ranges and bot swap sizes assumed token A = SOLV3/tSOL; made orientation-aware.
- fresh-deploy script: `grep -q` under `pipefail` misreads as "not found"; use counts.
- admin.mjs / exit.mjs / lifecycle.mjs hardcoded the real Treasury wallet; now default to the rehearsal Treasury (env `TREASURY` overrides). admin.mjs treats a missing ExitFeeConfig as the initial 40%. pauses2.mjs takes `EP` and `LOCK` from the environment. New helpers: wait-roll.mjs, check-split.mjs, fresh-deploy-rehearsal3.sh.
- Wallets run out of SOL under the swap bot (about 1,000 swaps per 2 epochs); top up before voting.
