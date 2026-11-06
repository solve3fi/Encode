import { AlmMarket } from "@/components/Beta/AlmMarket";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = {
	...createPageMetadata(
		"ALM market view (beta)",
		"Research preview: should you provide SOL liquidity or hold? Coming soon. Informational only, not financial advice.",
		"/beta/alm-market",
	),
	robots: { index: false, follow: false },
};

export default function AlmMarketPage() {
	return <AlmMarket />;
}
