"use client";

import { SwapProvider, useSwapStore } from "@/stores/swap/SwapProvider";
import { ArenaPairCard } from "@/components/V2/ArenaPairCard";
import { SwapAssetModal } from "./SwapAssetModal";
import { SwapSuccessModal } from "./SwapSuccessModal";
import { SwapWrapper } from "./SwapWrapper";
import { FundNudge } from "@/components/Fund/FundNudge";

const SwapPairCard: React.FC = () => {
	const from = useSwapStore((state) => state.from);
	const to = useSwapStore((state) => state.to);
	return (
		<div style={{ width: "100%", maxWidth: 520, margin: "0 auto" }}>
			<ArenaPairCard mintA={from ? String(from) : undefined} mintB={to ? String(to) : undefined} />
		</div>
	);
};

export const Swap: React.FC<{ syncUrl?: boolean }> = ({ syncUrl }) => {
	return (
		<SwapProvider syncUrl={syncUrl}>
			<FundNudge when="low" title="No SOL yet?" text="Get SOL or USDC from any chain to start trading." />
			<SwapWrapper />
			<SwapPairCard />
			<SwapAssetModal />
			<SwapSuccessModal />
		</SwapProvider>
	);
};
