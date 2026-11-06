import { notFound } from "next/navigation";
import { AgentApiOverview } from "@/components/Agent/AgentApiPages";
import { AGENT_ENABLED } from "@/configs/agent";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = {
	...createPageMetadata(
		"Solve3 Agent API",
		"Pay-per-request API for Solve3 voting. No account and no prepaying: billed in USDC automatically with x402. Devnet beta.",
		"/beta/agent/api",
	),
	robots: { index: false, follow: false },
};

export default function AgentApiPage() {
	if (!AGENT_ENABLED) notFound();
	return <AgentApiOverview />;
}
