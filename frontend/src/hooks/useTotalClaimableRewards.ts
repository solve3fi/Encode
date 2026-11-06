import { poll } from "@/lib/poll";
import { AddressUtil } from "@solve3fi/common";
import {
	collectFeesQuote,
	type Position,
	TokenExtensionUtil,
} from "@solve3fi/sdk";
import { collectRangeRewardsQuote } from "@/lib/nativeRewardQuote";
import { useQueries } from "@tanstack/react-query";
import BN from "bn.js";
import { useMemo } from "react";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { useAllPositions } from "./useAllPositions";
import { usePositions } from "./usePositions";

/**
 * Sum of unclaimed pool fees + reward tokens across every one of the
 * connected wallet's positions, per mint (raw units). Callers convert to
 * human units (via each mint's decimals, e.g. from useTokens) and price
 * them the same way RewardLiquidityFeeLists already does — this hook just
 * aggregates across positions instead of one.
 */
export const useTotalClaimableRewards = () => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const { data: allPositions, isLoading: positionsLoading } = useAllPositions();
	const { data: positions, isLoading: positionListLoading } =
		usePositions(allPositions);

	const quoteQueries = useQueries({
		queries: (positions ?? []).map((position: Position) => ({
			queryKey: [
				"totalClaimableRewardsQuote",
				network,
				position.getAddress().toString(),
			],
			queryFn: async () => {
				await position.refreshData();
				const solve = position.getSolveData();
				const tokenExtensionCtx =
					await TokenExtensionUtil.buildTokenExtensionContext(
						ctx.fetcher,
						solve,
					);

				const feeQuote = collectFeesQuote({
					position: position.getData(),
					tickLower: position.getLowerTickData(),
					tickUpper: position.getUpperTickData(),
					solve,
					tokenExtensionCtx,
				});
				const rewardQuote = collectRangeRewardsQuote({
					position: position.getData(),
					tickLower: position.getLowerTickData(),
					tickUpper: position.getUpperTickData(),
					solve,
					tokenExtensionCtx,
				});

				const amounts: Record<string, BN> = {
					[AddressUtil.toPubKey(solve.tokenMintA).toString()]:
						feeQuote.feeOwedA,
					[AddressUtil.toPubKey(solve.tokenMintB).toString()]:
						feeQuote.feeOwedB,
				};
				rewardQuote.rewardOwed.forEach((amount, index) => {
					if (!amount || amount.isZero()) return;
					const mint = solve.rewardInfos[index]?.mint;
					if (!mint) return;
					const key = AddressUtil.toPubKey(mint).toString();
					amounts[key] = (amounts[key] ?? new BN(0)).add(amount);
				});

				return amounts;
			},
			enabled: !!position,
			refetchInterval: poll(15_000),
		})),
	});

	const quotesLoading = quoteQueries.some((q) => q.isLoading);

	const amountsByMint = useMemo(() => {
		const map: Record<string, BN> = {};
		for (const q of quoteQueries) {
			if (!q.data) continue;
			for (const [mint, amount] of Object.entries(q.data)) {
				map[mint] = (map[mint] ?? new BN(0)).add(amount);
			}
		}
		return map;
	}, [quoteQueries]);

	return {
		amountsByMint,
		isLoading: positionsLoading || positionListLoading || quotesLoading,
	};
};
