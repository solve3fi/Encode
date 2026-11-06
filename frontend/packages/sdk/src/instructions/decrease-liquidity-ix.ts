import type { BN, Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import type { Solve } from "../artifacts/solve";

/**
 * Parameters to remove liquidity from a position.
 *
 * @category Instruction Types
 * @param liquidityAmount - The total amount of Liquidity the user is withdrawing
 * @param tokenMinA - The minimum amount of token A to remove from the position.
 * @param tokenMinB - The minimum amount of token B to remove from the position.
 * @param solve - PublicKey for the solve that the position will be opened for.
 * @param position - PublicKey for the  position will be opened for.
 * @param positionTokenAccount - PublicKey for the position token's associated token address.
 * @param tokenOwnerAccountA - PublicKey for the token A account that will be withdrawed from.
 * @param tokenOwnerAccountB - PublicKey for the token B account that will be withdrawed from.
 * @param tokenVaultA - PublicKey for the tokenA vault for this solve.
 * @param tokenVaultB - PublicKey for the tokenB vault for this solve.
 * @param tickArrayLower - PublicKey for the tick-array account that hosts the tick at the lower tick index.
 * @param tickArrayUpper - PublicKey for the tick-array account that hosts the tick at the upper tick index.
 * @param positionAuthority - authority that owns the token corresponding to this desired position.
 */
export type DecreaseLiquidityParams = {
  solve: PublicKey;
  solvesConfig: PublicKey;
  position: PublicKey;
  positionTokenAccount: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper: PublicKey;
  positionAuthority: PublicKey;
} & DecreaseLiquidityInput;

/**
 * @category Instruction Types
 */
export type DecreaseLiquidityInput = {
  tokenMinA: BN;
  tokenMinB: BN;
  liquidityAmount: BN;
};

/**
 * Remove liquidity to a position in the Solve.
 *
 * #### Special Errors
 * - `LiquidityZero` - Provided liquidity amount is zero.
 * - `LiquidityTooHigh` - Provided liquidity exceeds u128::max.
 * - `TokenMinSubceeded` - The required token to perform this operation subceeds the user defined amount.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - DecreaseLiquidityParams object
 * @returns - Instruction to perform the action.
 */
export function decreaseLiquidityIx(
  program: Program<Solve>,
  params: DecreaseLiquidityParams,
): Instruction {
  const {
    liquidityAmount,
    tokenMinA,
    tokenMinB,
    solve,
    positionAuthority,
    position,
    positionTokenAccount,
    tokenOwnerAccountA,
    tokenOwnerAccountB,
    tokenVaultA,
    tokenVaultB,
    tickArrayLower,
    tickArrayUpper,
    solvesConfig,
  } = params;

  const ix = program.instruction.decreaseLiquidity(
    liquidityAmount,
    tokenMinA,
    tokenMinB,
    {
      accounts: {
        solve,
        tokenProgram: TOKEN_PROGRAM_ID,
        positionAuthority,
        position,
        positionTokenAccount,
        tokenOwnerAccountA,
        tokenOwnerAccountB,
        tokenVaultA,
        tokenVaultB,
        tickArrayLower,
        tickArrayUpper,
        solvesConfig,
      },
    },
  );

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
