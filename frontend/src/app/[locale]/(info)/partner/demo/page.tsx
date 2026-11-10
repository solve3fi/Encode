import { MarketingLayout } from "@/components/Layout/MarketingLayout";
import { PartnerSpaceDemo } from "@/components/Partners/PartnerSpaceDemo";

// Sample partner space for walkthroughs. Static route, so it wins over /partner/[slug]. Not part of the mainnet build.
export default function PartnerDemoPage() {
	return (
		<MarketingLayout cta={{ label: "Open app", href: "/swap" }}>
			<PartnerSpaceDemo />
		</MarketingLayout>
	);
}
