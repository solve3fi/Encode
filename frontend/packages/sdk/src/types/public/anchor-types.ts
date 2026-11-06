import type { BN, Idl } from "anchor-legacy";
import { BorshAccountsCoder } from "anchor-legacy";
import type { PublicKey } from "@solana/web3.js";
import SolveIDL from "../../artifacts/solve.json";

/**
 * This file contains the types that has the same structure as the types anchor functions returns.
 * These types are hard-casted by the client function.
 *
 * This file must be manually updated every time the idl updates as accounts will
 * be hard-casted to fit the type.
 */

/**
 * Supported parasable account names from the Solve contract.
 * @category Network
 */
export enum AccountName {
  SolvesConfig = "SolvesConfig",
  Position = "Position",
  TickArray = "TickArray",
  Solve = "Solve",
  FeeTier = "FeeTier",
  PositionBundle = "PositionBundle",
  SolvesConfigExtension = "SolvesConfigExtension",
  TokenBadge = "TokenBadge",
}

export const SOLVE_IDL = SolveIDL as Idl;

/**
 * The Anchor coder for the Solve program.
 * @category Solana Accounts
 */
export const SOLVE_CODER = new BorshAccountsCoder(SOLVE_IDL);

/**
 * Get the size of an account owned by the Solve program in bytes.
 * @param accountName Solve account name
 * @returns Size in bytes of the account
 */
export function getAccountSize(accountName: AccountName) {
  const size = SOLVE_CODER.size(
    SOLVE_IDL.accounts!.find((account) => account.name === accountName)!,
  );
  return size + RESERVED_BYTES[accountName];
}

/**
 * Reserved bytes for each account used for calculating the account size.
 */
const RESERVED_BYTES: ReservedBytes = {
  [AccountName.SolvesConfig]: 2,
  [AccountName.Position]: 0,
  [AccountName.TickArray]: 0,
  [AccountName.Solve]: 0,
  [AccountName.FeeTier]: 0,
  [AccountName.PositionBundle]: 64,
  [AccountName.SolvesConfigExtension]: 512,
  [AccountName.TokenBadge]: 128,
};

type ReservedBytes = {
  [name in AccountName]: number;
};

/**
 * Size of the Solve account in bytes.
 * @deprecated Please use {@link getAccountSize} instead.
 * @category Solana Accounts
 */
export const SOLVE_ACCOUNT_SIZE = getAccountSize(AccountName.Solve);

/**
 * @category Solana Accounts
 */
export type SolvesConfigData = {
  feeAuthority: PublicKey;
  collectProtocolFeesAuthority: PublicKey;
  rewardEmissionsSuperAuthority: PublicKey;
  defaultFeeRate: number;
  defaultProtocolFeeRate: number;
};

/**
 * @category Solana Accounts
 */
export type SolveRewardInfoData = {
  mint: PublicKey;
  vault: PublicKey;
  authority: PublicKey;
  emissionsPerSecondX64: BN;
  growthGlobalX64: BN;
};

/**
 * @category Solana Accounts
 */
export type SolveBumpsData = {
  solveBump: number;
};

/**
 * @category Solana Accounts
 */
export type SolveData = {
  solvesConfig: PublicKey;
  solveBump: number[];
  feeRate: number;
  protocolFeeRate: number;
  liquidity: BN;
  sqrtPrice: BN;
  tickCurrentIndex: number;
  protocolFeeOwedA: BN;
  protocolFeeOwedB: BN;
  tokenMintA: PublicKey;
  tokenVaultA: PublicKey;
  feeGrowthGlobalA: BN;
  tokenMintB: PublicKey;
  tokenVaultB: PublicKey;
  feeGrowthGlobalB: BN;
  rewardLastUpdatedTimestamp: BN;
  rewardInfos: SolveRewardInfoData[];
  tickSpacing: number;
};

/**
 * @category Solana Accounts
 */
export type TickArrayData = {
  solve: PublicKey;
  startTickIndex: number;
  ticks: TickData[];
};

/**
 * @category Solana Accounts
 */
export type TickData = {
  initialized: boolean;
  liquidityNet: BN;
  liquidityGross: BN;
  feeGrowthOutsideA: BN;
  feeGrowthOutsideB: BN;
  rewardGrowthsOutside: BN[];
};

/**
 * @category Solana Accounts
 */
export type PositionRewardInfoData = {
  growthInsideCheckpoint: BN;
  amountOwed: BN;
};

/**
 * @category Solana Accounts
 */
export type OpenPositionBumpsData = {
  positionBump: number;
};

/**
 * @category Solana Accounts
 */
export type OpenPositionWithMetadataBumpsData = {
  positionBump: number;
  metadataBump: number;
};

/**
 * @category Solana Accounts
 */
export type PositionData = {
  solve: PublicKey;
  positionMint: PublicKey;
  liquidity: BN;
  tickLowerIndex: number;
  tickUpperIndex: number;
  feeGrowthCheckpointA: BN;
  feeOwedA: BN;
  feeGrowthCheckpointB: BN;
  feeOwedB: BN;
  rewardInfos: PositionRewardInfoData[];
};

/**
 * @category Solana Accounts
 */
export type FeeTierData = {
  solvesConfig: PublicKey;
  tickSpacing: number;
  defaultFeeRate: number;
};

/**
 * @category Solana Accounts
 */
export type PositionBundleData = {
  positionBundleMint: PublicKey;
  positionBitmap: number[];
};

/**
 * @category Solana Accounts
 */
export type SolvesConfigExtensionData = {
  solvesConfig: PublicKey;
  configExtensionAuthority: PublicKey;
  tokenBadgeAuthority: PublicKey;
};

/**
 * @category Solana Accounts
 */
export type TokenBadgeData = {
  solvesConfig: PublicKey;
  tokenMint: PublicKey;
};
