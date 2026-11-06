import type { Address } from "anchor-legacy";
import type {
  AccountFetcher,
  ParsableEntity,
  MintWithTokenProgram,
  AccountWithTokenProgram as TokenAccountWithTokenProgram,
} from "@solve3fi/common";
import {
  ParsableMintInfo,
  ParsableTokenAccountInfo,
  SimpleAccountFetcher,
} from "@solve3fi/common";
import { AccountLayout } from "@solana/spl-token";
import type { Connection, EpochInfo } from "@solana/web3.js";
import type {
  SolveAccountFetchOptions,
  SolveAccountFetcherInterface,
  SolveSupportedTypes,
} from "..";
import { DEFAULT_SOLVE_RETENTION_POLICY } from "..";
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
import {
  ParsableFeeTier,
  ParsablePosition,
  ParsablePositionBundle,
  ParsableTickArray,
  ParsableSolve,
  ParsableSolvesConfig,
  ParsableSolvesConfigExtension,
  ParsableTokenBadge,
} from "../parsing";

/**
 * Build a default instance of {@link SolveAccountFetcherInterface} with the default {@link AccountFetcher} implementation
 * @param connection An instance of {@link Connection} to use for fetching accounts
 * @returns An instance of {@link SolveAccountFetcherInterface}
 * @category Network
 */
export const buildDefaultAccountFetcher = (connection: Connection) => {
  return new SolveAccountFetcher(
    connection,
    new SimpleAccountFetcher(connection, DEFAULT_SOLVE_RETENTION_POLICY),
  );
};

/**
 * Fetcher and cache layer for fetching {@link SolveSupportedTypes} from the network
 * Default implementation for {@link SolveAccountFetcherInterface}
 * @category Network
 */
export class SolveAccountFetcher
  implements SolveAccountFetcherInterface
{
  private _accountRentExempt: number | undefined;
  private _epochInfo: EpochInfo | undefined;
  private _epochInfoNextFetchTime: number = 0;

  constructor(
    readonly connection: Connection,
    readonly fetcher: AccountFetcher<
      SolveSupportedTypes,
      SolveAccountFetchOptions
    >,
  ) {}

  async getAccountRentExempt(refresh: boolean = false): Promise<number> {
    // This value should be relatively static or at least not break according to spec
    // https://solana.com/docs/terminology#rent-exempt
    if (!this._accountRentExempt || refresh) {
      this._accountRentExempt =
        await this.connection.getMinimumBalanceForRentExemption(
          AccountLayout.span,
        );
    }
    return this._accountRentExempt;
  }

  async getEpoch(refresh: boolean = false): Promise<number> {
    if (
      !this._epochInfo ||
      Date.now() >= this._epochInfoNextFetchTime ||
      refresh
    ) {
      const epochInfo = await this.connection.getEpochInfo();

      // In theory, 1 slot per every 400ms.
      // 320ms is 80% of 400ms.
      const remainingSlotsInEpoch = Math.max(
        epochInfo.slotsInEpoch - epochInfo.slotIndex,
        0,
      );
      const nextFetchTime = Date.now() + remainingSlotsInEpoch * 320;

      this._epochInfo = epochInfo;
      this._epochInfoNextFetchTime = nextFetchTime;
    }
    return this._epochInfo.epoch;
  }

  getPool(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<SolveData | null> {
    return this.fetcher.getAccount(address, ParsableSolve, opts);
  }
  getPools(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, SolveData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableSolve, opts);
  }
  getPosition(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<PositionData | null> {
    return this.fetcher.getAccount(address, ParsablePosition, opts);
  }
  getPositions(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, PositionData | null>> {
    return this.fetcher.getAccounts(addresses, ParsablePosition, opts);
  }
  getTickArray(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<TickArrayData | null> {
    return this.fetcher.getAccount(address, ParsableTickArray, opts);
  }
  getTickArrays(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyArray<TickArrayData | null>> {
    return this.fetcher.getAccountsAsArray(addresses, ParsableTickArray, opts);
  }
  getFeeTier(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<FeeTierData | null> {
    return this.fetcher.getAccount(address, ParsableFeeTier, opts);
  }
  getFeeTiers(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, FeeTierData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableFeeTier, opts);
  }
  getTokenInfo(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<TokenAccountWithTokenProgram | null> {
    return this.fetcher.getAccount(address, ParsableTokenAccountInfo, opts);
  }
  getTokenInfos(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, TokenAccountWithTokenProgram | null>> {
    return this.fetcher.getAccounts(addresses, ParsableTokenAccountInfo, opts);
  }
  getMintInfo(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<MintWithTokenProgram | null> {
    return this.fetcher.getAccount(address, ParsableMintInfo, opts);
  }
  getMintInfos(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, MintWithTokenProgram | null>> {
    return this.fetcher.getAccounts(addresses, ParsableMintInfo, opts);
  }
  getConfig(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<SolvesConfigData | null> {
    return this.fetcher.getAccount(address, ParsableSolvesConfig, opts);
  }
  getConfigs(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, SolvesConfigData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableSolvesConfig, opts);
  }
  getPositionBundle(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<PositionBundleData | null> {
    return this.fetcher.getAccount(address, ParsablePositionBundle, opts);
  }
  getPositionBundles(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, PositionBundleData | null>> {
    return this.fetcher.getAccounts(addresses, ParsablePositionBundle, opts);
  }

  getConfigExtension(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<SolvesConfigExtensionData | null> {
    return this.fetcher.getAccount(
      address,
      ParsableSolvesConfigExtension,
      opts,
    );
  }
  getConfigExtensions(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, SolvesConfigExtensionData | null>> {
    return this.fetcher.getAccounts(
      addresses,
      ParsableSolvesConfigExtension,
      opts,
    );
  }

  getTokenBadge(
    address: Address,
    opts?: SolveAccountFetchOptions,
  ): Promise<TokenBadgeData | null> {
    return this.fetcher.getAccount(address, ParsableTokenBadge, opts);
  }
  getTokenBadges(
    addresses: Address[],
    opts?: SolveAccountFetchOptions,
  ): Promise<ReadonlyMap<string, TokenBadgeData | null>> {
    return this.fetcher.getAccounts(addresses, ParsableTokenBadge, opts);
  }

  populateCache<T extends SolveSupportedTypes>(
    accounts: ReadonlyMap<string, T>,
    parser: ParsableEntity<T>,
    now = Date.now(),
  ): void {
    this.fetcher.populateAccounts(accounts, parser, now);
  }
}
