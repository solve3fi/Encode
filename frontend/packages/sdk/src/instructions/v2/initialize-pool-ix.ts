import type { BN, Program } from "anchor-legacy";
import type { Instruction, PDA } from "@solve3fi/common";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import type { Solve } from "../../artifacts/solve";

/**
 * Parameters to initialize a Solve account.
 *
 * @category Instruction Types
 * @param initSqrtPrice - The desired initial sqrt-price for this pool
 * @param solvesConfig - The public key for the SolvesConfig this pool is initialized in
 * @param solvePda - PDA for the solve account that would be initialized
 * @param tokenMintA - Mint public key for token A
 * @param tokenMintB - Mint public key for token B
 * @param tokenBadgeA - TokenBadge public key for token A
 * @param tokenBadgeB - TokenBadge public key for token B
 * @param tokenProgramA - Token program public key for token A
 * @param tokenProgramB - Token program public key for token B
 * @param tokenVaultAKeypair - Keypair of the token A vault for this pool
 * @param tokenVaultBKeypair - Keypair of the token B vault for this pool
 * @param feeTierKey - PublicKey of the fee-tier account that this pool would use for the fee-rate
 * @param tickSpacing - The desired tick spacing for this pool.
 * @param funder - The account that would fund the creation of this account
 */
export type InitPoolV2Params = {
  initSqrtPrice: BN;
  solvesConfig: PublicKey;
  solvePda: PDA;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenBadgeA: PublicKey;
  tokenBadgeB: PublicKey;
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
  tokenVaultAKeypair: Keypair;
  tokenVaultBKeypair: Keypair;
  feeTierKey: PublicKey;
  tickSpacing: number;
  funder: PublicKey;
};

/**
 * Initializes a tick_array account to represent a tick-range in a Solve.
 *
 * Special Errors
 * `InvalidTokenMintOrder` - The order of mints have to be ordered by
 * `SqrtPriceOutOfBounds` - provided initial_sqrt_price is not between 2^-64 to 2^64
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - InitPoolV2Params object
 * @returns - Instruction to perform the action.
 */
export function initializePoolV2Ix(
  program: Program<Solve>,
  params: InitPoolV2Params,
): Instruction {
  const {
    initSqrtPrice,
    tokenMintA,
    tokenMintB,
    tokenBadgeA,
    tokenBadgeB,
    tokenProgramA,
    tokenProgramB,
    solvesConfig,
    solvePda,
    feeTierKey,
    tokenVaultAKeypair,
    tokenVaultBKeypair,
    tickSpacing,
    funder,
  } = params;

  const ix = program.instruction.initializePoolV2(tickSpacing, initSqrtPrice, {
    accounts: {
      solvesConfig,
      tokenMintA,
      tokenMintB,
      tokenBadgeA,
      tokenBadgeB,
      funder,
      solve: solvePda.publicKey,
      tokenVaultA: tokenVaultAKeypair.publicKey,
      tokenVaultB: tokenVaultBKeypair.publicKey,
      feeTier: feeTierKey,
      systemProgram: SystemProgram.programId,
      tokenProgramA,
      tokenProgramB,
      rent: SYSVAR_RENT_PUBKEY,
    },
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [tokenVaultAKeypair, tokenVaultBKeypair],
  };
}
