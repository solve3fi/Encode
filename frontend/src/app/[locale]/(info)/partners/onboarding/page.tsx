import { MarketingLayout } from "@/components/Layout/MarketingLayout";
import { OnboardingWizard } from "@/components/Partners/OnboardingWizard";

export default function OnboardingPage() {
	return (
		<MarketingLayout cta={{ label: "Open app", href: "/swap" }}>
			<OnboardingWizard />
		</MarketingLayout>
	);
}
