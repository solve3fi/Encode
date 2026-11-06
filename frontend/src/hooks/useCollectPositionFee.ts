import { useLingui } from "@lingui/react";
import { Transaction } from "@solana/web3.js";
import type { Position } from "@solve3fi/sdk";
import { useMutation } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { addBuilders } from "@/lib/transactionBuilders";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";

export type CollectPositionFee = {
	position?: Position;
	refetch?: () => void;
};

export const useCollectPositionFee = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);

	return useMutation({
		mutationKey: ["collectFee"],
		mutationFn: async (data: CollectPositionFee) => {
			const { position, refetch } = data;
			if (!position) throw new Error("Position not found");

			const transactions = new Transaction();
			// Pools with native SOL need each builder's signers and cleanup instructions.
			const signers = addBuilders(transactions, [
				...(await position.collectRewards()),
				await position.collectFees(),
			]);

			const signature = await ctx.provider.sendAndConfirm(transactions, signers);
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
				title: i18n._("Collect Fee"),
				message: i18n._("Collect Fee Failed!"),
			});
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Collect Fee"),
				message: i18n._("Collect Fee Success!"),
			});
		},
	});
};
