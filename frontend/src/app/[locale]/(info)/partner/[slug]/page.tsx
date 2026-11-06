import { MarketingLayout } from "@/components/Layout/MarketingLayout";
import { PartnerSpace } from "@/components/Partners/PartnerSpace";

// The private partner link. The slug alone reveals nothing: the page asks the connected wallet to
// sign, and the server only answers wallets registered on this space.
export default async function PartnerLink({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	return (
		<MarketingLayout cta={{ label: "Open app", href: "/swap" }}>
			<PartnerSpace slug={slug} />
		</MarketingLayout>
	);
}
