import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to set the collect fee authority in a SolvesConfig
 *
 * @category Instruction Types
 * @param solvesConfig - The public key for the SolvesConfig this pool is initialized in
 * @param collectProtocolFeesAuthority - The current collectProtocolFeesAuthority in the SolvesConfig
 * @param newCollectProtocolFeesAuthority - The new collectProtocolFeesAuthority in the SolvesConfig
 */
export type SetCollectProtocolFeesAuthorityParams = {
  solvesConfig: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  newCollectProtocolFeesAuthority: PublicKey;
};

/**
 * Sets the fee authority to collect protocol fees for a SolvesConfig.
 * Only the current collect protocol fee authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetCollectProtocolFeesAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setCollectProtocolFeesAuthorityIx(
  program: Program<Solve>,
  params: SetCollectProtocolFeesAuthorityParams,
): Instruction {
  const {
    solvesConfig,
    collectProtocolFeesAuthority,
    newCollectProtocolFeesAuthority,
  } = params;

  const ix = program.instruction.setCollectProtocolFeesAuthority({
    accounts: {
      solvesConfig,
      collectProtocolFeesAuthority,
      newCollectProtocolFeesAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
