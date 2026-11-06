import { YieldHunterSoon } from "@/components/Beta/YieldHunterSoon";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = {
	...createPageMetadata(
		"Yield Hunter (beta)",
		"A USDC vault that moves deposits between Solana lending protocols. Coming soon, not open for deposits.",
		"/beta/yield-hunter",
	),
	robots: { index: false, follow: false },
};

export default function YieldHunterPage() {
	return <YieldHunterSoon />;
}
