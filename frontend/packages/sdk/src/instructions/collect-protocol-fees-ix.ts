import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to collect protocol fees for a Solve
 *
 * @category Instruction Types
 * @param solvesConfig - The public key for the SolvesConfig this pool is initialized in
 * @param solve - PublicKey for the solve that the position will be opened for.
 * @param tokenVaultA - PublicKey for the tokenA vault for this solve.
 * @param tokenVaultB - PublicKey for the tokenB vault for this solve.
 * @param tokenOwnerAccountA - PublicKey for the associated token account for tokenA in the collection wallet
 * @param tokenOwnerAccountB - PublicKey for the associated token account for tokenA in the collection wallet
 * @param collectProtocolFeesAuthority - assigned authority in the SolvesConfig that can collect protocol fees
 */
export type CollectProtocolFeesParams = {
  solvesConfig: PublicKey;
  solve: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
};

/**
 * Collect protocol fees accrued in this Solve.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectProtocolFeesParams object
 * @returns - Instruction to perform the action.
 */
export function collectProtocolFeesIx(
  program: Program<Solve>,
  params: CollectProtocolFeesParams,
): Instruction {
  const {
    solvesConfig,
    solve,
    collectProtocolFeesAuthority,
    tokenVaultA,
    tokenVaultB,
    tokenOwnerAccountA: tokenDestinationA,
    tokenOwnerAccountB: tokenDestinationB,
  } = params;

  const ix = program.instruction.collectProtocolFees({
    accounts: {
      solvesConfig,
      solve,
      collectProtocolFeesAuthority,
      tokenVaultA,
      tokenVaultB,
      tokenDestinationA,
      tokenDestinationB,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
