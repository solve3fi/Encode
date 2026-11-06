import { getAllSolveAccountsForConfig } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { HIDDEN_POOL_ADDRESSES } from "@/configs/hiddenPools";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

// Single source of truth for hidden pools: configs/hiddenPools.ts (also used by the Vote pages).
export const HIDDEN_POOLS = HIDDEN_POOL_ADDRESSES;

export const useAllPools = () => {
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
			return data
				? Array.from(data.entries())
						.filter(([address, data]) => data !== null && !HIDDEN_POOLS.has(address))
						.map(([address, _]) => address)
						.filter(Boolean)
				: [];
		},
	});
};
