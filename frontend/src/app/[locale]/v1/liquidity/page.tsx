import { Liquidity } from "@/components/Liquidity";
import { LAUNCH_POOLS_ANCHOR } from "@/configs/genesis";
import { LegacyAppLayout } from "@/components/Layout/LegacyAppLayout";

export default function Page() {
	return (
		<LegacyAppLayout>
			<div id={LAUNCH_POOLS_ANCHOR}>
				<Liquidity />
			</div>
		</LegacyAppLayout>
	);
}
