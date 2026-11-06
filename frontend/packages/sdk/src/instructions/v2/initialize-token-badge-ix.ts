import type { Program } from "anchor-legacy";
import type { Instruction, PDA } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import { SystemProgram } from "@solana/web3.js";
import type { Solve } from "../../artifacts/solve";

/**
 * Parameters to initialize a TokenBadge account.
 *
 * @category Instruction Types
 * @param solvesConfig - The public key for the SolvesConfig
 * @param solvesConfigExtension - The public key for the SolvesConfigExtension
 * @param tokenBadgeAuthority - The public key for the tokenBadgeAuthority
 * @param tokenMint - The public key for the mint for which the TokenBadge is being initialized
 * @param tokenBadgePda - The PDA for the TokenBadge account
 * @param funder - The account that would fund the creation of this account
 */
export type InitializeTokenBadgeParams = {
  solvesConfig: PublicKey;
  solvesConfigExtension: PublicKey;
  tokenBadgeAuthority: PublicKey;
  tokenMint: PublicKey;
  tokenBadgePda: PDA;
  funder: PublicKey;
};

/**
 * Initializes a TokenBadge account.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - InitializeTokenBadgeParams object
 * @returns - Instruction to perform the action.
 */
export function initializeTokenBadgeIx(
  program: Program<Solve>,
  params: InitializeTokenBadgeParams,
): Instruction {
  const {
    solvesConfig,
    solvesConfigExtension,
    tokenBadgeAuthority,
    tokenMint,
    tokenBadgePda,
    funder,
  } = params;

  const ix = program.instruction.initializeTokenBadge({
    accounts: {
      solvesConfig,
      solvesConfigExtension,
      tokenBadgeAuthority,
      tokenMint,
      tokenBadge: tokenBadgePda.publicKey,
      funder,
      systemProgram: SystemProgram.programId,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
