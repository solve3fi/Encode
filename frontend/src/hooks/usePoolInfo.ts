import { poll } from "@/lib/poll";
import type { Address } from "@solve3fi/common";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export const usePoolInfo = (poolId?: Address) => {
	const { network } = useCluster();
	const { client, ctx } = useClient(DEX_PROGRAM_ID[network]);
	return useQuery({
		queryKey: ["poolInfo", network, poolId?.toString(), ctx.wallet.publicKey?.toString()],
		queryFn: async () => await client.getPool(poolId ?? "", IGNORE_CACHE),
		staleTime: 15_000,
		refetchInterval: poll(15_000),
		enabled: !!poolId?.toString(),
	});
};
