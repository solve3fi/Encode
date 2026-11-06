import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to update the reward authority at a particular rewardIndex on a Solve.
 *
 * @category Instruction Types
 * @param solve - PublicKey for the solve to update.
 * @param rewardIndex - The reward index that we'd like to update. (0 <= index <= NUM_REWARDS).
 * @param rewardAuthority - The current rewardAuthority in the Solve at the rewardIndex
 * @param newRewardAuthority - The new rewardAuthority in the Solve at the rewardIndex
 */
export type SetRewardAuthorityParams = {
  solve: PublicKey;
  rewardIndex: number;
  rewardAuthority: PublicKey;
  newRewardAuthority: PublicKey;
};

/**
 * Set the solve reward authority at the provided `reward_index`.
 * Only the current reward authority for this reward index has permission to invoke this instruction.
 *
 * #### Special Errors
 * - `InvalidRewardIndex` - If the provided reward index doesn't match the lowest uninitialized index in this pool,
 *                          or exceeds NUM_REWARDS.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetRewardAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setRewardAuthorityIx(
  program: Program<Solve>,
  params: SetRewardAuthorityParams,
): Instruction {
  const { solve, rewardAuthority, newRewardAuthority, rewardIndex } =
    params;
  const ix = program.instruction.setRewardAuthority(rewardIndex, {
    accounts: {
      solve,
      rewardAuthority,
      newRewardAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
