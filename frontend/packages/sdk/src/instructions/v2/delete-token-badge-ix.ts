import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../../artifacts/solve";

/**
 * Parameters to delete a TokenBadge account.
 *
 * @category Instruction Types
 * @param solvesConfig - PublicKey for the solves config account
 * @param solvesConfigExtension - PublicKey for the solves config extension account
 * @param tokenBadgeAuthority - PublicKey for the token badge authority
 * @param tokenMint - Publickey for the mint for which the TokenBadge have been initialized
 * @param tokenBadge - PublicKey for the token badge account to be deleted
 * @param receiver - PublicKey for the account that will receive the rent
 */
export type DeleteTokenBadgeParams = {
  solvesConfig: PublicKey;
  solvesConfigExtension: PublicKey;
  tokenBadgeAuthority: PublicKey;
  tokenMint: PublicKey;
  tokenBadge: PublicKey;
  receiver: PublicKey;
};

/**
 * Deletes a TokenBadge account.
 *
 * @category Instructions
 * @param program - program object containing services required to generate the instruction
 * @param params - DeleteTokenBadgeParams object
 * @returns - Instruction to perform the action.
 */
export function deleteTokenBadgeIx(
  program: Program<Solve>,
  params: DeleteTokenBadgeParams,
): Instruction {
  const {
    solvesConfig,
    solvesConfigExtension,
    tokenBadgeAuthority,
    tokenMint,
    tokenBadge,
    receiver,
  } = params;

  const ix = program.instruction.deleteTokenBadge({
    accounts: {
      solvesConfig,
      solvesConfigExtension,
      tokenBadgeAuthority,
      tokenMint,
      tokenBadge,
      receiver,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
