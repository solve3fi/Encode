import { useLingui } from "@lingui/react";
import type { IncreaseLiquidityQuote, Position } from "@solve3fi/sdk";
import { useMutation } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { assertGenesisTokenPairAllowed } from "@/configs/genesis";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export type IncreasePositionQuote = {
	position?: Position;
	quote?: IncreaseLiquidityQuote;
	refetch?: () => void;
};

export const useIncreasePosition = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);

	return useMutation({
		mutationKey: ["increasePosition"],
		mutationFn: async (data: IncreasePositionQuote) => {
			const { position, quote, refetch } = data;
			if (!quote || !position) throw new Error("Invalid data");
			const poolData = position.getSolveData();
			assertGenesisTokenPairAllowed(
				poolData.tokenMintA.toString(),
				poolData.tokenMintB.toString(),
			);

			const tx = await position.increaseLiquidity(quote);
			const signature = await tx.buildAndExecute({
				blockhashCommitment: "finalized",
			});
			const latest_blockhash = await ctx.connection.getLatestBlockhash();
			await ctx.connection.confirmTransaction(
				{ signature, ...latest_blockhash },
				"confirmed",
			);

			await refetch?.();
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Add Liquidity"),
				message: i18n._("Add liquidity failed!"),
			});
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Add Liquidity"),
				message: i18n._("Add liquidity successfully!"),
			});
		},
	});
};
