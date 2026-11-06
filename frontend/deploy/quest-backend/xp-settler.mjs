// Devnet TEST XP settler. Every minute it reads the checked weekly swap qualification and records a
// weekly test receipt for each completed quest. The receipt store enforces the calendar, the
// active week, the source watermark and the XP ceilings; a database trigger then turns each new
// receipt into one XP award (migration 018). This process has its own least-privilege login, no
// route, and cannot write XP directly.
//
//   QUEST_XP_WRITER_DB_URL        login with the settler grants only
//   QUEST_SWAP_CAMPAIGN_ID        the seeded swap source campaign
//   QUEST_CALENDAR_CAMPAIGN_ID    the published calendar (weekly quests)
//   QUEST_ENVIRONMENT_ID, QUEST_MANIFEST_SHA256   the pinned database identity
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createDevnetSwapProgressProvider } from "../scripts/quest/devnet-swap-progress-config.mjs";
import { runSettlementRound } from "../scripts/quest/devnet-xp-settlement.mjs";
import { createWeeklyTestReceiptStore } from "../scripts/quest/quest-weekly-test-store.mjs";

async function main() {
	const need = (name) => {
		const value = process.env[name];
		if (!value) throw new Error(`Missing required setting ${name}`);
		return value;
	};
	const environment = {
		network: "DEVNET",
		environmentId: need("QUEST_ENVIRONMENT_ID"),
		manifestSha256: need("QUEST_MANIFEST_SHA256"),
	};
	const interval = Math.min(
		600,
		Math.max(15, Number(process.env.QUEST_SETTLER_INTERVAL_SECONDS ?? 60)),
	);
	const log = (value) =>
		console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...value }));
	const pool = new pg.Pool({
		connectionString: need("QUEST_XP_WRITER_DB_URL"),
		max: 3,
		connectionTimeoutMillis: 3000,
		idleTimeoutMillis: 10_000,
		query_timeout: 8000,
		statement_timeout: 8000,
		idle_in_transaction_session_timeout: 10_000,
	});
	let stopping = false;
	for (const signal of ["SIGTERM", "SIGINT"])
		process.on(signal, () => {
			stopping = true;
		});
	const swapCampaign = need("QUEST_SWAP_CAMPAIGN_ID");
	const calendarCampaign = need("QUEST_CALENDAR_CAMPAIGN_ID");
	while (!stopping) {
		try {
			const provider = await createDevnetSwapProgressProvider({
				pool,
				campaignId: swapCampaign,
				environment,
			});
			const store = createWeeklyTestReceiptStore({
				pool,
				environment,
				sourcePins: provider.sourcePins,
			});
			await runSettlementRound({
				provider,
				store,
				calendarCampaignId: calendarCampaign,
				// One governance Level per Passport per ended epoch (migration 020). The function does the
				// work inside the database; this login can run it and nothing else about Levels.
				settleVoting: async () =>
					(await pool.query("SELECT quest.settle_voting_epochs() AS result")).rows[0].result,
				// The pause switches (migration 022). While weekly-xp is paused no weekly receipt is recorded.
				readPauses: async () =>
					(await pool.query("SELECT quest.pause_status() AS status")).rows[0].status,
				log,
			});
		} catch (error) {
			log({
				action: "xp_settler_failed",
				error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
			});
		}
		for (let waited = 0; waited < interval && !stopping; waited++)
			await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	await pool.end().catch(() => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	await main();
