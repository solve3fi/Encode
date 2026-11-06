import { AddressUtil } from "@solve3fi/common";
import {
	collectFeesQuote,
	type Position,
	TokenExtensionUtil,
} from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export const usePositionFeesQuote = (position?: Position) => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	return useQuery({
		queryKey: ["positionFeeQuote", network, position?.getAddress().toString()],
		enabled: !!position,
		staleTime: 15_000,
		refetchInterval: 15_000,
		queryFn: async () => {
			await position?.refreshData();
			const solve = position?.getSolveData();

			if (!solve || !position) {
				return [undefined, undefined];
			}

			const tokenExtensionCtx =
				await TokenExtensionUtil.buildTokenExtensionContextForPool(
					ctx.fetcher,
					AddressUtil.toPubKey(solve.tokenMintA),
					AddressUtil.toPubKey(solve.tokenMintB),
				);

			const feeQuote = collectFeesQuote({
				position: position.getData(),
				tickLower: position.getLowerTickData(),
				tickUpper: position.getUpperTickData(),
				solve,
				tokenExtensionCtx,
			});

			return [feeQuote.feeOwedA, feeQuote.feeOwedB];
		},
	});
};
