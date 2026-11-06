import { getAllPositionAccountsByOwner } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export const useAllPositions = () => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	return useQuery({
		queryKey: ["allPositions", network, ctx.wallet?.publicKey?.toBase58()],
		queryFn: async () =>
			await getAllPositionAccountsByOwner({
				owner: ctx.wallet?.publicKey,
				ctx,
			}),
		select(data) {
			return data
				? Array.from(data.positions.entries())
						.filter(([_, data]) => data !== null)
						.map(([address, _]) => address)
						.filter(Boolean)
				: [];
		},
		enabled: !!network && !!ctx.wallet?.publicKey,
	});
};
