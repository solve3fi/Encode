import type { Address } from "anchor-legacy";
import type {
  BasicSupportedTypes,
  ParsableEntity,
  SimpleAccountFetchOptions,
  MintWithTokenProgram,
  AccountWithTokenProgram as TokenAccountWithTokenProgram,
} from "@solve3fi/common";
import type {
  FeeTierData,
  PositionBundleData,
  PositionData,
  TickArrayData,
  TokenBadgeData,
  SolveData,
  SolvesConfigData,
  SolvesConfigExtensionData,
} from "../../../types/public";

/**
 * Union type of all the {@link ParsableEntity} types that can be cached in the {@link SolveAccountFetcherInterface}
 * @category Network
 */
export type SolveSupportedTypes =
  | SolvesConfigData
  | SolveData
  | PositionData
  | TickArrayData
  | FeeTierData
  | PositionBundleData
  | SolvesConfigExtensionData
  | TokenBadgeData
  | BasicSupportedTypes;

/**
 * The default retention periods for each {@link ParsableEntity} type in the {@link SolveAccountFetcherInterface}
 * @category Network
 */
export const DEFAULT_SOLVE_RETENTION_POLICY: ReadonlyMap<
  ParsableEntity<SolveSupportedTypes>,
  number
> = new Map<ParsableEntity<SolveSupportedTypes>, number>([]);

/**
 * Type to define fetch options for the {@link SolveAccountFetcherInterface}
 * @category Network
 */
export type SolveAccountFetchOptions = SimpleAccountFetchOptions;

/**
 * Default fetch option for always fetching when making an account request to the {@link SolveAccountFetcherInterface}
 * @category Network
 */
export const IGNORE_CACHE: SolveAccountFetchOptions = { maxAge: 0 };

/**
 * Default fetch option for always using the cached value for an account request to the {@link SolveAccountFetcherInterface}
 * @category Network
 */
export const PREFER_CACHE: SolveAccountFetchOptions = {
  maxAge: Number.POSITIVE_INFINITY,
};

/**
 * Fetcher interface for fetching {@link SolveSupportedTypes} from the network
 * @category Network
 */
export interface SolveAccountFetcherInterface {
  /**
   * Fetch and cache the rent exempt value
   * @param refresh If true, will always fetch from the network
   */
  getAccountRentExempt(refresh?: boolean): Promise<number>;

  /**
   * Fetch and cache the current epoch info
   * @param refresh If true, will always fetch from the network
   */
  getEpoch(refresh?: boolean): Promise<number>;

  /**
   * Fetch and cache the account for a given Solve addresses
   * @param address The mint address
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getPool(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<SolveData | null>;

  /**
   * Fetch and cache the accounts for a given array of Solve addresses
   * @param addresses The array of mint addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getPools(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, SolveData | null>>;

  /**
   * Fetch and cache the account for a given Position address
   * @param address The address of the position account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getPosition(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<PositionData | null>;

  /**
   * Fetch and cache the accounts for a given array of Position addresses
   * @param addresses The array of position account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getPositions(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, PositionData | null>>;

  /**
   * Fetch and cache the account for a given TickArray address.
   * @param address The address of the tick array account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getTickArray(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<TickArrayData | null>;

  /**
   * Fetch and cache the accounts for a given array of TickArray addresses
   * @param addresses The array of tick array account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getTickArrays(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyArray<TickArrayData | null>>;

  /**
   * Fetch and cache the account for a given FeeTier address
   * @param address The address of the fee tier account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getFeeTier(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<FeeTierData | null>;

  /**
   * Fetch and cache the accounts for a given array of FeeTier addresses
   * @param addresses The array of fee tier account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getFeeTiers(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, FeeTierData | null>>;

  /**
   * Fetch and cache the account for a given TokenAccount address
   * @param address The address of the token account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getTokenInfo(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<TokenAccountWithTokenProgram | null>;

  /**
   * Fetch and cache the accounts for a given array of TokenAccount addresses
   * @param addresses The array of token account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getTokenInfos(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, TokenAccountWithTokenProgram | null>>;

  /**
   * Fetch and cache the account for a given Mint address
   * @param address The address of the mint account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getMintInfo(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<MintWithTokenProgram | null>;

  /**
   * Fetch and cache the accounts for a given array of Mint addresses
   * @param addresses The array of mint account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getMintInfos(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, MintWithTokenProgram | null>>;

  /**
   * Fetch and cache the account for a given SolveConfig address
   * @param address The address of the SolveConfig account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getConfig(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<SolvesConfigData | null>;

  /**
   * Fetch and cache the accounts for a given array of SolveConfig addresses
   * @param addresses The array of SolveConfig account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getConfigs(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, SolvesConfigData | null>>;

  /**
   * Fetch and cache the account for a given PositionBundle address
   * @param address The address of the position bundle account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getPositionBundle(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<PositionBundleData | null>;

  /**
   * Fetch and cache the accounts for a given array of PositionBundle addresses
   * @param addresses The array of position bundle account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getPositionBundles(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, PositionBundleData | null>>;

  /**
   * Fetch and cache the account for a given SolveConfigExtension address
   * @param address The address of the SolveConfigExtension account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getConfigExtension(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<SolvesConfigExtensionData | null>;

  /**
   * Fetch and cache the accounts for a given array of SolveConfigExtension addresses
   * @param addresses The array of SolveConfigExtension account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getConfigExtensions(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, SolvesConfigExtensionData | null>>;

  /**
   * Fetch and cache the account for a given TokenBadge address
   * @param address The address of the TokenBadge account
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getTokenBadge(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<TokenBadgeData | null>;

  /**
   * Fetch and cache the accounts for a given array of TokenBadge addresses
   * @param addresses The array of TokenBadge account addresses
   * @param opts {@link SolveAccountFetchOptions} instance to dictate fetch behavior
   */
  getTokenBadges(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, TokenBadgeData | null>>;

  /**
   * Populate the fetcher's cache with the given {@link SolvesData} accounts
   * @param accounts The map of addresses to on-chain account data
   * @param parser The {@link ParsableEntity} instance to parse the accounts
   * @param now The current timestamp to use for the cache
   */
  populateCache<T extends SolveSupportedTypes>(
    accounts: ReadonlyMap<string, T>,
    parser: ParsableEntity<T>,
    now: number,
  ): void;
}
