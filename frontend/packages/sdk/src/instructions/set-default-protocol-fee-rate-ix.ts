import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to set the default fee rate for a FeeTier.
 *
 * @category Instruction Types
 * @param solvesConfig - The public key for the SolvesConfig this pool is initialized in
 * @param feeAuthority - Authority authorized in the SolvesConfig to set default fee rates.
 * @param defaultProtocolFeeRate - The new default protocol fee rate for this config. Stored as a basis point of the total fees collected by feeRate.
 */
export type SetDefaultProtocolFeeRateParams = {
  solvesConfig: PublicKey;
  feeAuthority: PublicKey;
  defaultProtocolFeeRate: number;
};

/**
 * Updates a SolvesConfig with a new default protocol fee rate. The new rate will not retroactively update
 * initialized pools.
 *
 * #### Special Errors
 * - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetDefaultFeeRateParams object
 * @returns - Instruction to perform the action.
 */
export function setDefaultProtocolFeeRateIx(
  program: Program<Solve>,
  params: SetDefaultProtocolFeeRateParams,
): Instruction {
  const { solvesConfig, feeAuthority, defaultProtocolFeeRate } = params;

  const ix = program.instruction.setDefaultProtocolFeeRate(
    defaultProtocolFeeRate,
    {
      accounts: {
        solvesConfig,
        feeAuthority,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
