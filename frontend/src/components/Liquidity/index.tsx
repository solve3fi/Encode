"use client";

import { LiquidityProvider } from "@/stores/liquidity/LiquidityProvider";
import { LiquidityWrapper } from "./LiquidityWrapper";

export const Liquidity: React.FC = () => {
	return (
		<LiquidityProvider>
			<LiquidityWrapper />
		</LiquidityProvider>
	);
};
