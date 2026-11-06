import { poll } from "@/lib/poll";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { DEVNET_USDC } from "@/configs/tokens";
import { deriveDevnetPrices, type PricingPool } from "@/lib/devnetPricing";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { useAllPools } from "./useAllPools";

export function useDevnetPrices() {
	const { network, cluster } = useCluster();
	const { client } = useClient(DEX_PROGRAM_ID[network]);
	const pools = useAllPools();
	const query = useQuery({
		queryKey: ["devnetSpotPrices", network, cluster.endpoint, pools.data?.join(",")],
		enabled: network === ClusterNetwork.Devnet && !!pools.data?.length,
		queryFn: async () => {
			const snapshots: PricingPool[] = (await client.getPools(pools.data ?? [], IGNORE_CACHE)).map((pool) => ({
				address: pool.getAddress().toString(),
				mintA: pool.getTokenAInfo().mint.toString(),
				mintB: pool.getTokenBInfo().mint.toString(),
				decimalsA: pool.getTokenAInfo().decimals,
				decimalsB: pool.getTokenBInfo().decimals,
				sqrtPrice: pool.getData().sqrtPrice.toString(),
				liquidity: pool.getData().liquidity.toString(),
				amountA: pool.getTokenVaultAInfo().amount.toString(),
				amountB: pool.getTokenVaultBInfo().amount.toString(),
			}));
			return { prices: deriveDevnetPrices(snapshots, DEVNET_USDC.address), snapshots };
		},
		staleTime: 30_000,
		refetchInterval: poll(30_000),
	});
	return { ...query, isLoading: pools.isLoading || query.isLoading, isError: pools.isError || query.isError, error: pools.error ?? query.error };
}
