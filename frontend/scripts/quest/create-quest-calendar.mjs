import { writeFileSync } from "node:fs";
import { createQuestCalendarExample } from "./quest-calendar-example.mjs";

const [yearText, path] = process.argv.slice(2);
if (process.argv.length !== 4 || !/^\d{4}$/.test(yearText ?? "") || !path)
	throw new Error(
		"Usage: node scripts/quest/create-quest-calendar.mjs 2027 ./quest-calendar-2027.json",
	);
const plan = createQuestCalendarExample(Number(yearText));
writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, {
	encoding: "utf8",
	flag: "wx",
});
console.log(
	`Created synthetic calendar: ${plan.weekCount} weeks, three quests per week, twelve monthly goals. XP is test-only.`,
);
