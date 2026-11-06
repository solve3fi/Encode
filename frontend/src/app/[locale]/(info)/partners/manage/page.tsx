import { MarketingLayout } from "@/components/Layout/MarketingLayout";
import { PartnerFind } from "@/components/Partners/PartnerFind";

export default function ManagePartnerSpace() {
	return (
		<MarketingLayout cta={{ label: "Open app", href: "/swap" }}>
			<PartnerFind />
		</MarketingLayout>
	);
}
