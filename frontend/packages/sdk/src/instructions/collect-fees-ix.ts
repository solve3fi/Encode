import type { Program } from "anchor-legacy";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

import type { Instruction } from "@solve3fi/common";

/**
 * Parameters to collect fees from a position.
 *
 * @category Instruction Types
 * @param solve - PublicKey for the solve that the position will be opened for.
 * @param position - PublicKey for the  position will be opened for.
 * @param positionTokenAccount - PublicKey for the position token's associated token address.
 * @param tokenOwnerAccountA - PublicKey for the token A account that will be withdrawed from.
 * @param tokenOwnerAccountB - PublicKey for the token B account that will be withdrawed from.
 * @param tokenVaultA - PublicKey for the tokenA vault for this solve.
 * @param tokenVaultB - PublicKey for the tokenB vault for this solve.
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 */
export type CollectFeesParams = {
  solve: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  positionAuthority: PublicKey;
};

/**
 * Collect fees accrued for this position.
 * Call updateFeesAndRewards before this to update the position to the newest accrued values.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectFeesParams object
 * @returns - Instruction to perform the action.
 */
export function collectFeesIx(
  program: Program<Solve>,
  params: CollectFeesParams,
): Instruction {
  const {
    solve,
    positionAuthority,
    position,
    positionTokenAccount,
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenVaultA,
    tokenVaultB,
  } = params;

  const ix = program.instruction.collectFees({
    accounts: {
      solve,
      positionAuthority,
      position,
      positionTokenAccount,
      tokenOwnerAccountA,
      tokenOwnerAccountB,
      tokenVaultA,
      tokenVaultB,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
