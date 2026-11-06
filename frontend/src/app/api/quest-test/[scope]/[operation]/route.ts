import "server-only";
import { createQuestTestProxy } from "../../../../../../scripts/quest/quest-test-proxy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
	request: Request,
	context: { params: Promise<{ scope: string; operation: string }> },
) {
	const { scope, operation } = await context.params;
	return createQuestTestProxy({
		enabled: process.env.QUEST_TEST_UI_ENABLED === "true",
		webOrigin: process.env.QUEST_TEST_WEB_ORIGIN,
		backendOrigin: process.env.QUEST_TEST_BACKEND_ORIGIN,
	})(scope, operation, request);
}
