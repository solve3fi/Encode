import { previewDevnetQuests } from "./devnet-quest-lab.mjs";
import { DEVNET_QUEST_SCENARIOS } from "./devnet-quest-scenarios.mjs";

const requested = process.argv.slice(2);
if (requested.length > 1 || (requested.length === 1 && requested[0] !== "--all" &&
	!DEVNET_QUEST_SCENARIOS.some((scenario) => scenario.name === requested[0]))) {
	process.stderr.write(
		`Usage: node scripts/quest/preview-devnet-quests.mjs [--all|${DEVNET_QUEST_SCENARIOS.map((scenario) => scenario.name).join("|")}]\n`,
	);
	process.exitCode = 2;
} else {
	const selected =
		requested.length === 0 || requested[0] === "--all"
			? DEVNET_QUEST_SCENARIOS
			: DEVNET_QUEST_SCENARIOS.filter((scenario) => scenario.name === requested[0]);
	process.stdout.write(
		`${JSON.stringify({
			label: "DEVNET SYNTHETIC TEST ONLY — NO AWARDS OR REWARDS",
			previews: selected.map((scenario) => ({
				scenario: scenario.name,
				...previewDevnetQuests(scenario.snapshot),
			})),
		}, null, 2)}\n`,
	);
}
