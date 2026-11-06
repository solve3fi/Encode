import BN from "bn.js";
import type { TokenInfo } from "..";
import { PoolUtil } from "..";
import type {
  SolveAccountFetchOptions,
  SolveAccountFetcherInterface,
} from "../network/public/fetcher";
import type {
  TokenAccountInfo,
  SolveData,
  SolveRewardInfo,
  SolveRewardInfoData,
} from "../types/public";

export async function getTokenMintInfos(
  fetcher: SolveAccountFetcherInterface,
  data: SolveData,
  opts?: SolveAccountFetchOptions,
): Promise<TokenInfo[]> {
  const mintA = data.tokenMintA;
  const infoA = await fetcher.getMintInfo(mintA, opts);
  if (!infoA) {
    throw new Error(`Unable to fetch MintInfo for mint - ${mintA}`);
  }
  const mintB = data.tokenMintB;
  const infoB = await fetcher.getMintInfo(mintB, opts);
  if (!infoB) {
    throw new Error(`Unable to fetch MintInfo for mint - ${mintB}`);
  }
  return [
    { mint: mintA, ...infoA },
    { mint: mintB, ...infoB },
  ];
}

export async function getRewardInfos(
  fetcher: SolveAccountFetcherInterface,
  data: SolveData,
  opts?: SolveAccountFetchOptions,
): Promise<SolveRewardInfo[]> {
  const rewardInfos: SolveRewardInfo[] = [];
  for (const rewardInfo of data.rewardInfos) {
    rewardInfos.push(await getRewardInfo(fetcher, rewardInfo, opts));
  }
  return rewardInfos;
}

async function getRewardInfo(
  fetcher: SolveAccountFetcherInterface,
  data: SolveRewardInfoData,
  opts?: SolveAccountFetchOptions,
): Promise<SolveRewardInfo> {
  const rewardInfo = { ...data, initialized: false, vaultAmount: new BN(0) };
  if (PoolUtil.isRewardInitialized(data)) {
    const vaultInfo = await fetcher.getTokenInfo(data.vault, opts);
    if (!vaultInfo) {
      throw new Error(
        `Unable to fetch TokenAccountInfo for vault - ${data.vault}`,
      );
    }
    rewardInfo.initialized = true;
    rewardInfo.vaultAmount = new BN(vaultInfo.amount.toString());
  }
  return rewardInfo;
}

export async function getTokenVaultAccountInfos(
  fetcher: SolveAccountFetcherInterface,
  data: SolveData,
  opts?: SolveAccountFetchOptions,
): Promise<TokenAccountInfo[]> {
  const vaultA = data.tokenVaultA;
  const vaultInfoA = await fetcher.getTokenInfo(vaultA, opts);
  if (!vaultInfoA) {
    throw new Error(`Unable to fetch TokenAccountInfo for vault - ${vaultA}`);
  }
  const vaultB = data.tokenVaultB;
  const vaultInfoB = await fetcher.getTokenInfo(vaultB, opts);
  if (!vaultInfoB) {
    throw new Error(`Unable to fetch TokenAccountInfo for vault - ${vaultB}`);
  }
  return [vaultInfoA, vaultInfoB];
}
