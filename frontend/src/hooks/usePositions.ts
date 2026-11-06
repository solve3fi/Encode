import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export const usePositions = (positions: string[] | undefined) => {
	const { network } = useCluster();
	const { client } = useClient(DEX_PROGRAM_ID[network]);

	return useQuery({
		queryKey: ["positions", network, positions?.join(",")],
		queryFn: async () => await client.getPositions(positions || []),
		select(data) {
			return Object.values(data).filter((position) => position !== null);
		},
		enabled: !!positions?.length,
	});
};
