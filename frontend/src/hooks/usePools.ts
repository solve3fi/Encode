import { poll } from "@/lib/poll";
import { useQuery } from "@tanstack/react-query";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export const usePools = (pools: string[] | undefined) => {
	const { network } = useCluster();
	const { client } = useClient(DEX_PROGRAM_ID[network]);

	return useQuery({
		queryKey: ["pools", network, pools?.join(",")],
		queryFn: async () => await client.getPools(pools || [], IGNORE_CACHE),
		staleTime: 30_000,
		refetchInterval: poll(30_000),
		select(data) {
			return Array.from(data.values()).filter((pool) => pool !== null);
		},
		enabled: !!pools?.length,
	});
};
