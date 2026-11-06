import { notFound } from "next/navigation";
import { AgentApiSetup } from "@/components/Agent/AgentApiPages";
import { AGENT_ENABLED } from "@/configs/agent";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = {
	...createPageMetadata(
		"Set up the Solve3 Agent API",
		"Step-by-step setup: a small payer wallet, then connect the API to Claude, Codex or a script. Devnet beta.",
		"/beta/agent/api/setup",
	),
	robots: { index: false, follow: false },
};

export default function AgentApiSetupPage() {
	if (!AGENT_ENABLED) notFound();
	return <AgentApiSetup />;
}
