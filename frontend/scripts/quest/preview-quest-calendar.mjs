import { readFileSync } from "node:fs";
import { previewQuestCalendar } from "./quest-calendar.mjs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";

// Local file input only. No RPC, wallet, database, ledger or server route.
const [planPath, clock] = process.argv.slice(2);
if (process.argv.length > 4)
	throw new Error(
		"Usage: node scripts/quest/preview-quest-calendar.mjs [plan.json] [ISO timestamp]",
	);
const plan = planPath
	? JSON.parse(readFileSync(planPath, "utf8"))
	: createQuestCalendarExample();
const nowMs = clock
	? Date.parse(clock)
	: Date.parse("2027-01-07T00:00:00.000Z");
console.log(JSON.stringify(previewQuestCalendar({ plan, nowMs }), null, 2));
