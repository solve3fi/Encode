import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to set fee rate for a Solve.
 *
 * @category Instruction Types
 * @param solve - PublicKey for the solve to update. This solve has to be part of the provided SolvesConfig space.
 * @param solvesConfig - The public key for the SolvesConfig this pool is initialized in
 * @param feeAuthority - Authority authorized in the SolvesConfig to set default fee rates.
 * @param feeRate - The new fee rate for this fee-tier. Stored as a hundredths of a basis point.
 */
export type SetFeeRateParams = {
  solve: PublicKey;
  solvesConfig: PublicKey;
  feeAuthority: PublicKey;
  feeRate: number;
};

/**
 * Sets the fee rate for a Solve.
 * Only the current fee authority has permission to invoke this instruction.
 *
 * #### Special Errors
 * - `FeeRateMaxExceeded` - If the provided fee_rate exceeds MAX_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetFeeRateParams object
 * @returns - Instruction to perform the action.
 */
export function setFeeRateIx(
  program: Program<Solve>,
  params: SetFeeRateParams,
): Instruction {
  const { solvesConfig, solve, feeAuthority, feeRate } = params;

  const ix = program.instruction.setFeeRate(feeRate, {
    accounts: {
      solvesConfig,
      solve,
      feeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
