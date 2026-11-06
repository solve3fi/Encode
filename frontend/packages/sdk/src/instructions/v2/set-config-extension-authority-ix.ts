import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../../artifacts/solve";

/**
 * Parameters to set the token badge authority in a SolvesConfigExtension
 *
 * @category Instruction Types
 * @param solvesConfig - PublicKey for the solves config account
 * @param solvesConfigExtension - The public key for the SolvesConfigExtension
 * @param configExtensionAuthority - The current configExtensionAuthority in the SolvesConfigExtension
 * @param newConfigExtensionAuthority - The new configExtensionAuthority in the SolvesConfigExtension
 */
export type SetConfigExtensionAuthorityParams = {
  solvesConfig: PublicKey;
  solvesConfigExtension: PublicKey;
  configExtensionAuthority: PublicKey;
  newConfigExtensionAuthority: PublicKey;
};

/**
 * Sets the config extension authority for a SolvesConfigExtension.
 * Only the current config extension authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetTokenBadgeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setConfigExtensionAuthorityIx(
  program: Program<Solve>,
  params: SetConfigExtensionAuthorityParams,
): Instruction {
  const {
    solvesConfig,
    solvesConfigExtension,
    configExtensionAuthority,
    newConfigExtensionAuthority,
  } = params;

  const ix = program.instruction.setConfigExtensionAuthority({
    accounts: {
      solvesConfig,
      solvesConfigExtension,
      configExtensionAuthority,
      newConfigExtensionAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
