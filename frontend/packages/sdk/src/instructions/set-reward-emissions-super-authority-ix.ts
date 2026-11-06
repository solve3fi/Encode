import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to set rewards emissions for a reward in a Solve
 *
 * @category Instruction Types
 * @param solvesConfig - PublicKey for the SolvesConfig that we want to update.
 * @param rewardEmissionsSuperAuthority - Current reward emission super authority in this SolvesConfig
 * @param newRewardEmissionsSuperAuthority - New reward emission super authority for this SolvesConfig
 */
export type SetRewardEmissionsSuperAuthorityParams = {
  solvesConfig: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  newRewardEmissionsSuperAuthority: PublicKey;
};

/**
 * Set the solve reward super authority for a SolvesConfig
 * Only the current reward super authority has permission to invoke this instruction.
 * This instruction will not change the authority on any `SolveRewardInfo` solve rewards.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetRewardEmissionsSuperAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setRewardEmissionsSuperAuthorityIx(
  program: Program<Solve>,
  params: SetRewardEmissionsSuperAuthorityParams,
): Instruction {
  const {
    solvesConfig,
    rewardEmissionsSuperAuthority,
    newRewardEmissionsSuperAuthority,
  } = params;

  const ix = program.instruction.setRewardEmissionsSuperAuthority({
    accounts: {
      solvesConfig,
      rewardEmissionsSuperAuthority: rewardEmissionsSuperAuthority,
      newRewardEmissionsSuperAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
