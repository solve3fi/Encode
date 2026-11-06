import { type Address, AddressUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PDAUtil, PoolUtil, type Solve } from "@solve3fi/sdk";
import { useQueries } from "@tanstack/react-query";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { type FeeAmount, TICK_SPACINGS } from "@/stores/pool";

export enum PoolState {
	LOADING = "loading",
	NOT_EXISTS = "not_exists",
	EXISTS = "exists",
	INVALID = "invalid",
}

export const usePoolsState = (
	poolKeys: [
		tokenA: TokenInfo | undefined,
		tokenB: TokenInfo | undefined,
		feeAmount: FeeAmount | undefined,
	][],
): [PoolState, Solve | null][] => {
	const { network } = useCluster();
	const { client } = useClient(DEX_PROGRAM_ID[network]);

	const poolTokens: ([Address, Address, FeeAmount] | undefined)[] =
		poolKeys.map(([currencyA, currencyB, feeAmount]) => {
			if (!currencyA || !currencyB || !feeAmount) return undefined;
			const [tokenA, tokenB] = PoolUtil.orderMints(
				currencyA.address,
				currencyB.address,
			);
			return [tokenA, tokenB, feeAmount];
		});

	const poolIds: (string | undefined)[] = poolTokens.map((value) => {
		if (!value) return undefined;
		const poolKey = PDAUtil.getSolve(
			DEX_PROGRAM_ID[network],
			PROGRAM_CONFIG[network],
			AddressUtil.toPubKey(value[0]),
			AddressUtil.toPubKey(value[1]),
			TICK_SPACINGS[value[2]],
		);
		return poolKey.publicKey.toBase58();
	});

	const queryResults = useQueries({
		queries: poolIds.map((value) => ({
			queryKey: ["poolInfo", network, value],
			queryFn: async () => {
				if (!value) return null;
				try {
					const pool = await client.getPool(value);
					return pool;
				} catch {
					return null;
				}
			},
			enabled: !!value,
		})),
	});

	const poolData = queryResults.map((result) => result.data);
	return poolKeys.map((_, index) => {
		const pool = poolData[index];
		const poolId = poolIds[index];

		if (!poolId) return [PoolState.INVALID, null];
		if (pool === undefined) return [PoolState.LOADING, null];
		if (pool === null) return [PoolState.NOT_EXISTS, null];

		return [PoolState.EXISTS, pool];
	});
};

export const usePoolState = (
	currencyA: TokenInfo | undefined,
	currencyB: TokenInfo | undefined,
	feeAmount: FeeAmount | undefined,
): [PoolState, Solve | null] => {
	const poolKeys: [
		TokenInfo | undefined,
		TokenInfo | undefined,
		FeeAmount | undefined,
	][] = [[currencyA, currencyB, feeAmount]];

	return usePoolsState(poolKeys)[0];
};
