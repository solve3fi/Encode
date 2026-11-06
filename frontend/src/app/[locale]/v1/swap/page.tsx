import { GenesisBanner } from "@/components/Genesis/GenesisUI";
import { TradeModes } from "@/components/Swap/TradeModes";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { LegacyAppLayout } from "@/components/Layout/LegacyAppLayout";

export default function Page() {
	return (
		<LegacyAppLayout>
			{GENESIS_PUBLIC_ENABLED && (
				<GenesisBanner title="Swap. Provide liquidity. Grow together.">
					Early liquidity. Real trading. A stronger Solana together.
				</GenesisBanner>
			)}
			<TradeModes />
		</LegacyAppLayout>
	);
}
