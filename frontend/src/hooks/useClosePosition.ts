import { useLingui } from "@lingui/react";
import type { Address, Percentage } from "@solve3fi/common";
import type { Solve } from "@solve3fi/sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";

export type ClosePositionQuote = {
	pool: Solve | null;
	positionAddress: Address;
	slippage: Percentage;
	refetch?: () => void;
};

export const useClosePosition = () => {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["closePosition"],
		mutationFn: async (data: ClosePositionQuote) => {
			const { pool, positionAddress, slippage, refetch } = data;

			if (!pool || !positionAddress) throw new Error("Pool not found");

			const tx = await pool.closePosition(positionAddress, slippage);
			if (!tx.length) throw new Error("No close-position transaction was produced");
			// The SDK confirms each transaction using the blockhash it actually sent.
			// Close can require several transactions (fees/rewards, then the position).
			for (const builder of tx) {
				await builder.buildAndExecute({ blockhashCommitment: "confirmed" }, undefined, "confirmed");
			}

			await refetch?.();
			void queryClient.invalidateQueries();
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Close Liquidity"),
				message: `${i18n._("Remove liquidity failed!")} ${error.message || "Check your wallet and retry."}`,
			});
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Close Liquidity"),
				message: i18n._("Remove liquidity successfully!"),
			});
		},
	});
};
