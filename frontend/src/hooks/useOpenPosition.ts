import { useLingui } from "@lingui/react";
import type { IncreaseLiquidityQuote, Solve } from "@solve3fi/sdk";
import { useMutation } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { assertGenesisTokenPairAllowed } from "@/configs/genesis";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export type PositionQuoteIx = {
	pool: Solve | null;
	tickLower?: number;
	tickUpper?: number;
	quote?: IncreaseLiquidityQuote;
	refetch?: () => void;
};

export const useOpenPosition = () => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const { i18n } = useLingui();

	return useMutation({
		mutationKey: ["openPosition"],
		mutationFn: async (data: PositionQuoteIx) => {
			const { pool, quote, tickLower, tickUpper, refetch } = data;

			if (
				!pool ||
				!quote ||
				typeof tickLower !== "number" ||
				typeof tickUpper !== "number"
			)
				throw new Error("Invalid data");
			const poolData = pool.getData();
			assertGenesisTokenPairAllowed(
				poolData.tokenMintA.toString(),
				poolData.tokenMintB.toString(),
			);

			if (!quote.liquidityAmount || quote.liquidityAmount.isZero()) {
				throw new Error(
					i18n._(
						"Deposit amount is too small for this price range — increase the amount or widen the range.",
					),
				);
			}

			const initTickTx = await pool.initTickArrayForTicks(
				[tickLower, tickUpper],
				ctx.wallet.publicKey,
			);

			const { tx } = await pool.openPositionWithMetadata(
				tickLower,
				tickUpper,
				quote,
			);

			if (initTickTx) {
				tx.prependInstruction(initTickTx.compressIx(false));
			}
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
				title: i18n._("Open Position"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Position opened failed!"),
			});
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Open Position"),
				message: i18n._("Position opened"),
			});
		},
	});
};
