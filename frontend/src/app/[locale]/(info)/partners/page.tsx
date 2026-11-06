import { MarketingLayout } from "@/components/Layout/MarketingLayout";
import { PartnersPage } from "@/components/Partners/PartnersPage";

export default function Partners() {
	return (
		<MarketingLayout cta={{ label: "Start a pilot", href: "#apply" }}>
			<PartnersPage />
		</MarketingLayout>
	);
}
