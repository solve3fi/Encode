import type { Program } from "anchor-legacy";
import type { Instruction, PDA } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import type { Solve } from "../../artifacts/solve";

/**
 * Parameters to initialize a SolvesConfigExtension account.
 *
 * @category Instruction Types
 * @
 */
export type InitConfigExtensionParams = {
  solvesConfig: PublicKey;
  solvesConfigExtensionPda: PDA;
  funder: PublicKey;
  feeAuthority: PublicKey;
};

/**
 * Initializes a SolvesConfigExtension account that hosts info & authorities
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitConfigExtensionParams object
 * @returns - Instruction to perform the action.
 */
export function initializeConfigExtensionIx(
  program: Program<Solve>,
  params: InitConfigExtensionParams,
): Instruction {
  const {
    solvesConfig,
    solvesConfigExtensionPda,
    funder,
    feeAuthority,
  } = params;

  const ix = program.instruction.initializeConfigExtension({
    accounts: {
      config: solvesConfig,
      configExtension: solvesConfigExtensionPda.publicKey,
      funder,
      feeAuthority,
      systemProgram: SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
