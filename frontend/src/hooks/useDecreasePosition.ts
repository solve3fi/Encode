import { useLingui } from "@lingui/react";
import type { DecreaseLiquidityQuote, Position } from "@solve3fi/sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";

export type DecreasePositionQuote = {
	position: Position;
	quote?: DecreaseLiquidityQuote;
	refetch?: () => void;
};

export const useDecreasePosition = () => {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["decreasePosition"],
		mutationFn: async (data: DecreasePositionQuote) => {
			const { position, quote, refetch } = data;
			if (!quote) throw new Error("Invalid data");

			const tx = await position.decreaseLiquidity(quote);
			await tx.buildAndExecute({ blockhashCommitment: "confirmed" }, undefined, "confirmed");

			await refetch?.();
			void queryClient.invalidateQueries();
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Decrease Liquidity"),
				message: `${i18n._("Decrease liquidity failed!")} ${error.message || "Check your wallet and retry."}`,
			});
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Decrease Liquidity"),
				message: i18n._("Decrease liquidity successfully!"),
			});
		},
	});
};
