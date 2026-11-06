import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata(
	"Fund from any chain",
	"Send assets from other chains and receive SOL or USDC in your Solana wallet, powered by Aurora Intents.",
	"/fund",
);
export default function Layout({ children }: { children: React.ReactNode }) {
	return children;
}
