import type { Percentage } from "@solve3fi/common";
import { LAMPORTS_PER_SOL, type VersionedTransaction } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import type { BestTrade } from "./useBestTrade";

export const useSwapFees = (trade: BestTrade, slippage: Percentage) => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	return useQuery({
		queryKey: ["networkFee", trade.routers?.subRoutes[0].path.edges],
		queryFn: async () => {
			if (trade.router && trade.routers) {
				const signature = await (
					await trade.router.swap(trade.routers, slippage, null)
				).build();
				const transaction =
					signature.transaction as unknown as VersionedTransaction;
				const feeCalculator = await ctx.connection.getFeeForMessage(
					transaction.message,
				);

				if (feeCalculator.value) {
					return feeCalculator.value / LAMPORTS_PER_SOL;
				}
			}

			return 5000 / LAMPORTS_PER_SOL;
		},
		enabled: !!trade.routers && !!trade.router,
	});
};
