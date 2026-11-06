import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { TickArrayData, SolveRewardInfoData } from "./anchor-types";
import type {
  AccountWithTokenProgram,
  MintWithTokenProgram,
} from "@solve3fi/common";

/**
 * Extended Mint type to host token info.
 * @category SolveClient
 */
export type TokenInfo = MintWithTokenProgram & { mint: PublicKey };

/**
 * Extended (token) Account type to host account info for a Token.
 * @category SolveClient
 */
export type TokenAccountInfo = AccountWithTokenProgram;

/**
 * Type to represent a reward for a reward index on a Solve.
 * @category SolveClient
 */
export type SolveRewardInfo = SolveRewardInfoData & {
  initialized: boolean;
  vaultAmount: BN;
};

/**
 * A wrapper class of a TickArray on a Solve
 * @category SolveClient
 */
export type TickArray = {
  address: PublicKey;
  startTickIndex: number;
  data: TickArrayData | null;
};
