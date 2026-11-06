import { useLingui } from "@lingui/react";
import type { Percentage } from "@solve3fi/common";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ReactNode } from "react";
import type { BestTrade } from "@/hooks/useBestTrade";
import { useSwap } from "@/hooks/useSwap";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import classes from "./SwapHandle.module.css";
import type { SwapSummary } from "./swapResult";

export type SwapHandleProps = {
	slippage: Percentage;
	trade: BestTrade;
	errorMessage?: ReactNode;
	isLoading: boolean;
	summary: SwapSummary;
};

export const SwapHandle: React.FC<SwapHandleProps> = ({
	isLoading,
	errorMessage,
	trade,
	slippage,
	summary,
}) => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const { setOpenModal } = useModalActions();
	const { mutate: swap, isPending: isSwapPending } = useSwap();
	const busy = isLoading || isSwapPending;

	if (!publicKey) {
		return (
			<button
				type="button"
				className={classes.primary}
				onClick={() => setOpenModal(ModalType.WALLET)}
			>
				{i18n._("Connect wallet")}
			</button>
		);
	}

	return (
		<button
			type="button"
			className={classes.primary}
			disabled={busy || Boolean(errorMessage)}
			aria-busy={busy}
			onClick={() => swap({ trade, slippage, summary })}
		>
			{busy ? i18n._("Loading quote…") : errorMessage ? errorMessage : i18n._("Swap")}
		</button>
	);
};
