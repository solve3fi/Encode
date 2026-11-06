import {
	type Position,
	TokenExtensionUtil,
} from "@solve3fi/sdk";
import { collectRangeRewardsQuote } from "@/lib/nativeRewardQuote";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export const useRewardFeesQuote = (position?: Position) => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);

	return useQuery({
		queryKey: ["rewardFeeQuote", network, position?.getAddress().toBase58()],
		queryFn: async () => {
			await position?.refreshData();
			const solve = position?.getSolveData();

			if (!solve || !position) {
				return [];
			}

			const tokenExtensionCtx =
				await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, solve);

			const rewardQuote = collectRangeRewardsQuote({
				position: position.getData(),
				tickLower: position.getLowerTickData(),
				tickUpper: position.getUpperTickData(),
				solve,
				tokenExtensionCtx,
			});

			return rewardQuote.rewardOwed;
		},
		enabled: !!position,
		refetchInterval: 15_000,
	});
};
