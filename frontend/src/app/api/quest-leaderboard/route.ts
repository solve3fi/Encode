import "server-only";
import { createLeaderboardProxy } from "../../../../scripts/quest/quest-leaderboard-proxy.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
 return createLeaderboardProxy({
  enabled: process.env.QUEST_TEST_UI_ENABLED === "true",
  backendOrigin: process.env.QUEST_PAUSE_BACKEND_ORIGIN || "http://quest-backend:8080",
 })(request);
}
