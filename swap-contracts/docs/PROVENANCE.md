# Provenance and licensing record

This is an engineering record, not legal advice. Counsel should confirm the conclusions.

## Why this repository was rebuilt

Orca published its Whirlpools code under Apache 2.0 until 26 February 2025. From 27 February 2025 the repository is
licensed under the "Orca License" (non-commercial use only; any use that benefits a competitor, explicitly including
DEXs and AMMs, needs Orca's written consent). Apache-2.0 grants for versions published before that date are not affected.

An earlier version of the Solve3 program was a copy of Orca's code from July 2025 and later, so it contained
Orca code committed after the license change. This repository replaces it with a program built from the last
Apache-2.0 version instead.

## What the base is

| | |
|---|---|
| Orca repository | https://github.com/orca-so/whirlpools |
| Last whole-repository commit under Apache 2.0 | `e528dd23bb41571f92cfdb49a2f15d4fa0b01bec` (2025-02-26) |
| Last change to the program source before the cutoff | `7f0ca73f` (2025-02-14), program v0.3.4 |
| License at that commit | Apache-2.0 (repository `LICENSE`, Copyright 2022 Orca Foundation) |

## What was removed from the previous Solve3 code

Orca code first committed after 26 February 2025: position locking (27 Feb 2025), the events module including the
swap `Traded` event (28 Feb), reset-position-range and transfer-locked-position (18 Apr), the adaptive-fee suite,
the oracle and the fee-rate manager (30 Apr), dynamic tick arrays and the tick-array manager (4 Jul), token-badge
attributes, config feature flags and control flags, and the reward-authority migration instruction.

## How the result was checked

1. For every file, the closest matching Orca revision (any date) was chosen as the merge base, and the file was
   three-way merged against the Apache-era text, so that Orca's later changes are reverted and only Solve3's own lines
   are carried over.
2. A contamination audit compared every line of 28 or more characters in the result against every line in Orca's program
   source committed after the cutoff (25 commits scanned, 5,318 distinct post-cutoff-only lines). Result: 4 flagged
   lines in 4 files, all generic idioms (a function signature, an import path, a struct field). No substantive
   post-cutoff Orca code remains.
3. Features that depended on Orca's post-cutoff layout (Solve3's gauge schedule and activity gate were stored in Orca's
   later "extension" area) are being re-implemented on the Apache-era account layout as Solve3's own code.

## Known limits of this record

- It compares source text. It cannot prove that no idea or structure was influenced by Orca's later code.
- The audit threshold ignores lines shorter than 28 characters.
- The earlier public history of this repository (a single squashed commit dated 26 July 2025) is superseded by this one.
- The first deployments of the previous program were on 25 July 2025 (mainnet and devnet); the mainnet program has since
  been closed.

## Orca's Apache-2.0 trail

Orca's own statement: "The code in this repository was available until February 26th, 2025 under the Apache 2.0 license.
Beginning on February 27th, 2025, the code in this repository is licensed pursuant to the Orca License." (Orca
`LICENSE`, commit `ca5f0540`).
