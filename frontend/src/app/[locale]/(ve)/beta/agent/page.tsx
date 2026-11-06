import { notFound } from "next/navigation";
import { AgentView } from "@/components/Agent/AgentView";
import { AppLayout } from "@/components/Layout/AppLayout";
import { AGENT_ENABLED } from "@/configs/agent";

export default function AgentPage() {
	if (!AGENT_ENABLED) notFound();
	return (
		<AppLayout>
			<AgentView />
		</AppLayout>
	);
}
