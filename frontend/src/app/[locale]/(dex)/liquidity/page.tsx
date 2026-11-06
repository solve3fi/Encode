import { FeaturedGenesisPools } from "@/components/Genesis/GenesisCampaignPanels";
import { GenesisBanner } from "@/components/Genesis/GenesisUI";
import { AppLayout } from "@/components/Layout/AppLayout";
import { Liquidity } from "@/components/Liquidity";
import { GENESIS_PUBLIC_ENABLED, LAUNCH_POOLS_ANCHOR } from "@/configs/genesis";

export default function LiquidityPage() {
	return (
		<AppLayout>
			{GENESIS_PUBLIC_ENABLED && (
				<>
					<GenesisBanner title="Genesis Pools">
						Provide liquidity, earn trading fees, and learn about planned
						Genesis incentives.
					</GenesisBanner>
					<FeaturedGenesisPools />
				</>
			)}
			{/* Target of the Genesis page's "Choose a pool" step. */}
			<div id={LAUNCH_POOLS_ANCHOR}>
				<Liquidity />
			</div>
		</AppLayout>
	);
}
