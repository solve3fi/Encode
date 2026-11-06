import { notFound } from "next/navigation";
import { AgentIntro } from "@/components/Agent/AgentIntro";
import { AGENT_ENABLED } from "@/configs/agent";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = {
	...createPageMetadata(
		"Solve3 Agent",
		"Your weekly voting co-pilot: claim every reward, vote with a plan, and let the agent vote for you. Devnet beta.",
		"/beta/agent/intro",
	),
	robots: { index: false, follow: false },
};

export default function AgentIntroPage() {
	if (!AGENT_ENABLED) notFound();
	return <AgentIntro />;
}
