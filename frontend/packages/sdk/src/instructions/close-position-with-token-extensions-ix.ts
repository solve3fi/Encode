import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to close a position (based on Token-2022) in a Solve.
 *
 * @category Instruction Types
 * @param receiver - PublicKey for the wallet that will receive the rented lamports.
 * @param position - PublicKey for the position.
 * @param positionMint - PublicKey for the mint token for the Position token.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param positionAuthority - Authority that owns the position token.
 */
export type ClosePositionWithTokenExtensionsParams = {
  receiver: PublicKey;
  position: PublicKey;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  positionAuthority: PublicKey;
};

/**
 * Close a position in a Solve. Burns the position token in the owner's wallet.
 * Mint and TokenAccount are based on Token-2022. And Mint accout will be also closed.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - ClosePositionWithTokenExtensionsParams object
 * @returns - Instruction to perform the action.
 */
export function closePositionWithTokenExtensionsIx(
  program: Program<Solve>,
  params: ClosePositionWithTokenExtensionsParams,
): Instruction {
  const ix = program.instruction.closePositionWithTokenExtensions({
    accounts: {
      ...params,
      token2022Program: TOKEN_2022_PROGRAM_ID,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
