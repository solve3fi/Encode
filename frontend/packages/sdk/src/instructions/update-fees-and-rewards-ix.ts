import type { Program } from "anchor-legacy";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

import type { Instruction } from "@solve3fi/common";

/**
 * Parameters to update fees and reward values for a position.
 *
 * @category Instruction Types
 * @param solve - PublicKey for the solve that the position will be opened for.
 * @param position - PublicKey for the  position will be opened for.
 * @param tickArrayLower - PublicKey for the tick-array account that hosts the tick at the lower tick index.
 * @param tickArrayUpper - PublicKey for the tick-array account that hosts the tick at the upper tick index.
 */
export type UpdateFeesAndRewardsParams = {
  solve: PublicKey;
  position: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
};

/**
 * Update the accrued fees and rewards for a position.
 *
 * #### Special Errors
 * `TickNotFound` - Provided tick array account does not contain the tick for this position.
 * `LiquidityZero` - Position has zero liquidity and therefore already has the most updated fees and reward values.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - UpdateFeesAndRewardsParams object
 * @returns - Instruction to perform the action.
 */
export function updateFeesAndRewardsIx(
  program: Program<Solve>,
  params: UpdateFeesAndRewardsParams,
): Instruction {
  const { solve, position, tickArrayLower, tickArrayUpper } = params;

  const ix = program.instruction.updateFeesAndRewards({
    accounts: {
      solve,
      position,
      tickArrayLower,
      tickArrayUpper,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
