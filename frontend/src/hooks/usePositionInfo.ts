import type { Address } from "@solve3fi/common";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export const usePositionInfo = (positionId?: Address) => {
	const { network } = useCluster();
	const { client, ctx } = useClient(DEX_PROGRAM_ID[network]);

	return useQuery({
		queryKey: ["positionInfo", network, positionId?.toString(), ctx.wallet.publicKey?.toString()],
		queryFn: async () => await client.getPosition(positionId ?? "", IGNORE_CACHE),
		staleTime: 15_000,
		refetchInterval: 15_000,
		enabled: !!positionId,
	});
};
