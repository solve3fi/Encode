# Audits

## LedgerOps security assessment (May 13, 2026)

[`2026-05-13-ledgerops-solve3-security-assessment.pdf`](2026-05-13-ledgerops-solve3-security-assessment.pdf)

| | |
|---|---|
| Auditor | LedgerOps |
| Testing window | February 16 to February 27, 2026 |
| Report date | May 13, 2026 (remediation validation) |
| Findings | 0 critical, 4 high, 2 medium, 1 low, 1 informational. All marked closed. |

**Scope.** The ve(3,3) governance programs: the SOLVE token program, the Solve3 core ve(3,3) logic (locks, gauge
voting, rewards distribution, fee accounting) and the veSOLVE vote-escrow NFT program.

**Not in scope.** The concentrated-liquidity (swap) program in this repository, which is a fork of Orca Whirlpools
under Apache 2.0. Orca's audits cover Orca's code; Solve3's modifications to it (gauge emissions, activity gates,
trading pauses, position events) have not been independently audited. See the [main README](../../README.md#security).
