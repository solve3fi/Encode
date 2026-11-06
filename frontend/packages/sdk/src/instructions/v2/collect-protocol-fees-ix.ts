import type { Program } from "anchor-legacy";
import type { Instruction } from "@solve3fi/common";
import type { AccountMeta, PublicKey } from "@solana/web3.js";
import type { Solve } from "../../artifacts/solve";
import { MEMO_PROGRAM_ADDRESS } from "../..";
import {
  RemainingAccountsBuilder,
  RemainingAccountsType,
} from "../../utils/remaining-accounts-util";

/**
 * Parameters to collect protocol fees for a Solve
 *
 * @category Instruction Types
 * @param solvesConfig - The public key for the SolvesConfig this pool is initialized in
 * @param solve - PublicKey for the solve that the position will be opened for.
 * @param collectProtocolFeesAuthority - assigned authority in the SolvesConfig that can collect protocol fees
 * @param tokenMintA - PublicKey for the token A mint.
 * @param tokenMintB - PublicKey for the token B mint.
 * @param tokenVaultA - PublicKey for the tokenA vault for this solve.
 * @param tokenVaultB - PublicKey for the tokenB vault for this solve.
 * @param tokenOwnerAccountA - PublicKey for the associated token account for tokenA in the collection wallet
 * @param tokenOwnerAccountB - PublicKey for the associated token account for tokenA in the collection wallet
 * @param tokenTransferHookAccountsA - Optional array of token transfer hook accounts for token A.
 * @param tokenTransferHookAccountsB - Optional array of token transfer hook accounts for token B.
 * @param tokenProgramA - PublicKey for the token program for token A.
 * @param tokenProgramB - PublicKey for the token program for token B.
 */
export type CollectProtocolFeesV2Params = {
  solvesConfig: PublicKey;
  solve: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  tokenVaultA: PublicKey;
  tokenVaultB: PublicKey;
  tokenOwnerAccountA: PublicKey;
  tokenOwnerAccountB: PublicKey;
  tokenTransferHookAccountsA?: AccountMeta[];
  tokenTransferHookAccountsB?: AccountMeta[];
  tokenProgramA: PublicKey;
  tokenProgramB: PublicKey;
};

/**
 * Collect protocol fees accrued in this Solve.
 *
 * @category Instructions
 * @param context - Context object containing services required to generate the instruction
 * @param params - CollectProtocolFeesV2Params object
 * @returns - Instruction to perform the action.
 */
export function collectProtocolFeesV2Ix(
  program: Program<Solve>,
  params: CollectProtocolFeesV2Params,
): Instruction {
  const {
    solvesConfig,
    solve,
    collectProtocolFeesAuthority,
    tokenMintA,
    tokenMintB,
    tokenVaultA,
    tokenVaultB,
    tokenTransferHookAccountsA,
    tokenTransferHookAccountsB,
    tokenOwnerAccountA: tokenDestinationA,
    tokenOwnerAccountB: tokenDestinationB,
    tokenProgramA,
    tokenProgramB,
  } = params;

  const [remainingAccountsInfo, remainingAccounts] =
    new RemainingAccountsBuilder()
      .addSlice(RemainingAccountsType.TransferHookA, tokenTransferHookAccountsA)
      .addSlice(RemainingAccountsType.TransferHookB, tokenTransferHookAccountsB)
      .build();

  const ix = program.instruction.collectProtocolFeesV2(remainingAccountsInfo, {
    accounts: {
      solvesConfig,
      solve,
      collectProtocolFeesAuthority,
      tokenMintA,
      tokenMintB,
      tokenVaultA,
      tokenVaultB,
      tokenDestinationA,
      tokenDestinationB,
      tokenProgramA,
      tokenProgramB,
      memoProgram: MEMO_PROGRAM_ADDRESS,
    },
    remainingAccounts,
  });

  return {
    instructions: [ix],
    cleanupInstructions: [],
    signers: [],
  };
}
