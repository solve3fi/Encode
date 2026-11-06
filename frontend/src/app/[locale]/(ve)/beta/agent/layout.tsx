import { createPageMetadata } from "@/lib/metadata";
export const metadata = {
	...createPageMetadata("Agent", "Optimise your vote and claim every voting reward with the Solve3 agent.", "/beta/agent"),
	robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
