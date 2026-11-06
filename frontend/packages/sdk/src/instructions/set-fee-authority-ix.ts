import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to set the fee authority in a SolvesConfig
 *
 * @category Instruction Types
 * @param solvesConfig - The public key for the SolvesConfig this pool is initialized in
 * @param feeAuthority - The current feeAuthority in the SolvesConfig
 * @param newFeeAuthority - The new feeAuthority in the SolvesConfig
 */
export type SetFeeAuthorityParams = {
  solvesConfig: PublicKey;
  feeAuthority: PublicKey;
  newFeeAuthority: PublicKey;
};

/**
 * Sets the fee authority for a SolvesConfig.
 * The fee authority can set the fee & protocol fee rate for individual pools or set the default fee rate for newly minted pools.
 * Only the current fee authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetFeeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setFeeAuthorityIx(
  program: Program<Solve>,
  params: SetFeeAuthorityParams,
): Instruction {
  const { solvesConfig, feeAuthority, newFeeAuthority } = params;

  const ix = program.instruction.setFeeAuthority({
    accounts: {
      solvesConfig,
      feeAuthority,
      newFeeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
