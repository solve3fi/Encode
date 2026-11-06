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
 * @param newTokenBadgeAuthority - The new tokenBadgeAuthority in the SolvesConfigExtension
 */
export type SetTokenBadgeAuthorityParams = {
  solvesConfig: PublicKey;
  solvesConfigExtension: PublicKey;
  configExtensionAuthority: PublicKey;
  newTokenBadgeAuthority: PublicKey;
};

/**
 * Sets the token badge authority for a SolvesConfigExtension.
 * The token badge authority can initialize TokenBadge.
 * Only the config extension authority has permission to invoke this instruction.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - SetTokenBadgeAuthorityParams object
 * @returns - Instruction to perform the action.
 */
export function setTokenBadgeAuthorityIx(
  program: Program<Solve>,
  params: SetTokenBadgeAuthorityParams,
): Instruction {
  const {
    solvesConfig,
    solvesConfigExtension,
    configExtensionAuthority,
    newTokenBadgeAuthority,
  } = params;

  const ix = program.instruction.setTokenBadgeAuthority({
    accounts: {
      solvesConfig,
      solvesConfigExtension,
      configExtensionAuthority,
      newTokenBadgeAuthority,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
