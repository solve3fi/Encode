"use client";

import { SwapProvider } from "@/stores/swap/SwapProvider";
import { SwapAssetModal } from "./SwapAssetModal";
import { SwapSuccessModal } from "./SwapSuccessModal";
import { SwapWrapper } from "./SwapWrapper";
import { FundNudge } from "@/components/Fund/FundNudge";

export const Swap: React.FC<{ syncUrl?: boolean }> = ({ syncUrl }) => {
	return (
		<SwapProvider syncUrl={syncUrl}>
			<FundNudge when="low" title="No SOL yet?" text="Get SOL or USDC from any chain to start trading." />
			<SwapWrapper />
			<SwapAssetModal />
			<SwapSuccessModal />
		</SwapProvider>
	);
};
