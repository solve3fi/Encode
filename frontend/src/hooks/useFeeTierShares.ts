import { getAllSolveAccountsForConfig } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { HIDDEN_POOLS } from "./useAllPools";

/**
 * Share of the listed pools that use each fee rate, as whole-number percentages keyed by fee rate
 * (e.g. 3000 = 0.30%). Shares an existing query with useAllPools; `undefined` until pools load.
 */
export const useFeeTierShares = () => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	return useQuery({
		queryKey: ["allPools", network, ctx.wallet?.publicKey?.toBase58()],
		queryFn: async () =>
			await getAllSolveAccountsForConfig({
				connection: ctx.connection,
				programId: DEX_PROGRAM_ID[network],
				configId: PROGRAM_CONFIG[network],
			}),
		enabled: !!network,
		select(data) {
			const counts = new Map<number, number>();
			let total = 0;
			for (const [address, pool] of data?.entries() ?? []) {
				if (pool === null || HIDDEN_POOLS.has(address)) continue;
				counts.set(pool.feeRate, (counts.get(pool.feeRate) ?? 0) + 1);
				total += 1;
			}
			return {
				total,
				share: (feeRate: number) =>
					total === 0
						? 0
						: Math.round(((counts.get(feeRate) ?? 0) / total) * 100),
			};
		},
	});
};
