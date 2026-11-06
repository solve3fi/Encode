import { AppLayout } from "@/components/Layout/AppLayout";
import { Arena } from "@/components/V2/Arena";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata(
	"Epoch Arena",
	"Vote with veSOLV3, add liquidity to the contenders and claim what they earn.",
	"/arena",
);

export default function ArenaPage() {
	return (
		<AppLayout>
			<Arena />
		</AppLayout>
	);
}
