import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to update the reward authority at a particular rewardIndex on a Solve.
 *
 * @category Instruction Types
 * @param solve - PublicKey for the solve to update. This solve has to be part of the provided SolvesConfig space.
 * @param solvesConfig - The public key for the SolvesConfig this pool is initialized in
 * @param rewardIndex - The reward index that we'd like to update. (0 <= index <= NUM_REWARDS).
 * @param rewardEmissionsSuperAuthority - The current rewardEmissionsSuperAuthority in the SolvesConfig
 * @param newRewardAuthority - The new rewardAuthority in the Solve at the rewardIndex
 */
export type SetRewardAuthorityBySuperAuthorityParams = {
  solve: PublicKey;
  solvesConfig: PublicKey;
  rewardIndex: number;
  rewardEmissionsSuperAuthority: PublicKey;
  newRewardAuthority: PublicKey;
};

/**
 * Set the solve reward authority at the provided `reward_index`.
 * Only the current reward super authority has permission to invoke this instruction.
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
export function setRewardAuthorityBySuperAuthorityIx(
  program: Program<Solve>,
  params: SetRewardAuthorityBySuperAuthorityParams,
): Instruction {
  const {
    solvesConfig,
    solve,
    rewardEmissionsSuperAuthority,
    newRewardAuthority,
    rewardIndex,
  } = params;

  const ix = program.instruction.setRewardAuthorityBySuperAuthority(
    rewardIndex,
    {
      accounts: {
        solvesConfig,
        solve,
        rewardEmissionsSuperAuthority,
        newRewardAuthority,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
