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
 * @param protocolFeeRate - The new default protocol fee rate for this pool. Stored as a basis point of the total fees collected by feeRate.
 */
export type SetProtocolFeeRateParams = {
  solve: PublicKey;
  solvesConfig: PublicKey;
  feeAuthority: PublicKey;
  protocolFeeRate: number;
};

/**
 * Sets the protocol fee rate for a Solve.
 * Only the current fee authority has permission to invoke this instruction.
 *
 * #### Special Errors
 * - `ProtocolFeeRateMaxExceeded` - If the provided default_protocol_fee_rate exceeds MAX_PROTOCOL_FEE_RATE.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetFeeRateParams object
 * @returns - Instruction to perform the action.
 */
export function setProtocolFeeRateIx(
  program: Program<Solve>,
  params: SetProtocolFeeRateParams,
): Instruction {
  const { solvesConfig, solve, feeAuthority, protocolFeeRate } = params;

  const ix = program.instruction.setProtocolFeeRate(protocolFeeRate, {
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
