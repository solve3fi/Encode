import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

import { PDAUtil } from "../utils/public";

/**
 * Parameters to set the default fee rate for a FeeTier.
 *
 * @category Instruction Types
 * @param solvesConfig - The public key for the SolvesConfig this fee-tier is initialized in
 * @param feeAuthority - Authority authorized in the SolvesConfig to set default fee rates.
 * @param tickSpacing - The tick spacing of the fee-tier that we would like to update.
 * @param defaultFeeRate - The new default fee rate for this fee-tier. Stored as a hundredths of a basis point.
 */
export type SetDefaultFeeRateParams = {
  solvesConfig: PublicKey;
  feeAuthority: PublicKey;
  tickSpacing: number;
  defaultFeeRate: number;
};

/**
 * Updates a fee tier account with a new default fee rate. The new rate will not retroactively update
 * initialized pools.
 *
 * #### Special Errors
 * - `FeeRateMaxExceeded` - If the provided default_fee_rate exceeds MAX_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetDefaultFeeRateParams object
 * @returns - Instruction to perform the action.
 */
export function setDefaultFeeRateIx(
  program: Program<Solve>,
  params: SetDefaultFeeRateParams,
): Instruction {
  const { solvesConfig, feeAuthority, tickSpacing, defaultFeeRate } =
    params;

  const feeTierPda = PDAUtil.getFeeTier(
    program.programId,
    solvesConfig,
    tickSpacing,
  );

  const ix = program.instruction.setDefaultFeeRate(defaultFeeRate, {
    accounts: {
      solvesConfig,
      feeTier: feeTierPda.publicKey,
      feeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
