import { AddressUtil } from "@solve3fi/common";
import { type Position, TokenExtensionUtil } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import type BN from "bn.js";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { collectRangeRewardsQuote } from "@/lib/nativeRewardQuote";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export type PositionEmission = { mint: string; amount: BN };

/** Unclaimed gauge emissions (reward-token amounts, raw units) for one position. */
export const usePositionEmissionQuote = (position?: Position) => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	return useQuery({
		queryKey: ["positionEmissionQuote", network, position?.getAddress().toString()],
		enabled: !!position,
		staleTime: 15_000,
		refetchInterval: 15_000,
		queryFn: async (): Promise<PositionEmission[]> => {
			if (!position) return [];
			await position.refreshData();
			const solve = position.getSolveData();
			const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(
				ctx.fetcher,
				solve,
			);
			const quote = collectRangeRewardsQuote({
				position: position.getData(),
				tickLower: position.getLowerTickData(),
				tickUpper: position.getUpperTickData(),
				solve,
				tokenExtensionCtx,
			});
			const emissions: PositionEmission[] = [];
			quote.rewardOwed.forEach((amount, index) => {
				const mint = solve.rewardInfos[index]?.mint;
				if (!amount || amount.isZero() || !mint) return;
				emissions.push({ mint: AddressUtil.toPubKey(mint).toString(), amount });
			});
			return emissions;
		},
	});
};
