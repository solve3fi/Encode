import type { Program } from "anchor-legacy";
import type { Instruction, PDA } from "@solve3fi/common";
import type { PublicKey } from "@solana/web3.js";
import { SOLVE_NFT_UPDATE_AUTH } from "..";
import type { Solve } from "../artifacts/solve";
import { openPositionWithTokenExtensionsAccounts } from "../utils/instructions-util";

/**
 * Parameters to open a position (based on Token-2022) in a Solve.
 *
 * @category Instruction Types
 * @param solve - PublicKey for the solve that the position will be opened for.
 * @param ownerKey - PublicKey for the wallet that will host the minted position token.
 * @param positionPda - PDA for the derived position address.
 * @param positionMint - PublicKey for the mint token for the Position token.
 * @param positionTokenAccount - The associated token address for the position token in the owners wallet.
 * @param funder - The account that would fund the creation of this account
 * @param tickLowerIndex - The tick specifying the lower end of the position range.
 * @param tickUpperIndex - The tick specifying the upper end of the position range.
 * @param withTokenMetadataExtension - If true, the position token will have a TokenMetadata extension.
 */
export type OpenPositionWithTokenExtensionsParams = {
  solve: PublicKey;
  owner: PublicKey;
  positionPda: PDA;
  positionMint: PublicKey;
  positionTokenAccount: PublicKey;
  funder: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
  withTokenMetadataExtension: boolean;
};

/**
 * Open a position in a Solve. A unique token will be minted to represent the position
 * in the users wallet. Additional TokenMetadata extension is initialized to identify the token if requested.
 * Mint and Token account are based on Token-2022.
 * The position will start off with 0 liquidity.
 *
 * #### Special Errors
 * `InvalidTickIndex` - If a provided tick is out of bounds, out of order or not a multiple of the tick-spacing in this pool.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - OpenPositionWithTokenExtensionsParams object and a derived PDA that hosts the position's metadata.
 * @returns - Instruction to perform the action.
 */
export function openPositionWithTokenExtensionsIx(
  program: Program<Solve>,
  params: OpenPositionWithTokenExtensionsParams,
): Instruction {
  const { tickLowerIndex, tickUpperIndex, withTokenMetadataExtension } = params;

  const ix = program.instruction.openPositionWithTokenExtensions(
    tickLowerIndex,
    tickUpperIndex,
    withTokenMetadataExtension,
    {
      accounts: {
        ...openPositionWithTokenExtensionsAccounts(params),
        metadataUpdateAuth: SOLVE_NFT_UPDATE_AUTH,
      },
    },
  );

  // TODO: Require Keypair and auto sign this ix
  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
