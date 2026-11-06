import { GenesisBanner } from "@/components/Genesis/GenesisUI";
import { AppLayout } from "@/components/Layout/AppLayout";
import { TradeModes } from "@/components/Swap/TradeModes";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";

export default function SwapPage() {
	return (
		<AppLayout>
			{GENESIS_PUBLIC_ENABLED && (
				<GenesisBanner title="Swap. Provide liquidity. Grow together.">
					Early liquidity. Real trading. A stronger Solana together.
				</GenesisBanner>
			)}
			<TradeModes />
		</AppLayout>
	);
}
