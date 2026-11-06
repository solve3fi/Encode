import { type Address, AddressUtil } from "@solve3fi/common";
import {
	type SolveAccountFetchOptions,
	TokenExtensionUtil,
} from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export const useTokenExtension = (
	tokenMintA?: Address,
	tokenMintB?: Address,
	opts?: SolveAccountFetchOptions,
) => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	return useQuery({
		queryKey: [
			"tokenExtension",
			tokenMintA?.toString(),
			tokenMintB?.toString(),
		],
		queryFn: async () =>
			await TokenExtensionUtil.buildTokenExtensionContextForPool(
				ctx.fetcher,
				AddressUtil.toPubKey(tokenMintA ?? ""),
				AddressUtil.toPubKey(tokenMintB ?? ""),
				opts,
			),
		enabled: !!tokenMintA && !!tokenMintB,
	});
};
