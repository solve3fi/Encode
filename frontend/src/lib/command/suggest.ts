import { ASK_EXAMPLES, EXAMPLES, FUND_EXAMPLES } from "./parse";
import type { PlanContext } from "./plan";

/**
 * Suggestions for the empty bar, based on what this wallet actually has. Pure and deterministic: the same wallet state
 * always gives the same list. Returns at most four, most useful first, and only commands the bar understands.
 */
export function suggestionsFor(ctx: PlanContext): string[] {
	const out: string[] = [];
	const add = (text: string) => {
		if (!out.includes(text)) out.push(text);
	};
	if (ctx.connected) {
		const solv3 = ctx.balances?.[ctx.solv3Address] ?? 0;
		const sol = ctx.balances?.[ctx.solAddress] ?? 0;
		const locks = ctx.locks?.length ?? 0;
		if (solv3 >= 1) add("Lock all my SOLV3");
		if (locks > 0) {
			add("Show my locks");
			const epoch = ctx.facts?.epoch;
			if (epoch?.state === "open" && epoch.remainingSeconds < 2 * 86400)
				add("Go to vote");
			add("Turn on auto-vote");
		}
		if (sol > 0.05 || solv3 > 0) add("What's my balance?");
		if (locks === 0 && solv3 < 1 && sol > 0.05) add("Swap 0.1 SOL for SOLV3");
	}
	add("What's the SOL price?");
	if (ctx.facts?.epoch) add("When does the epoch end?");
	return out.slice(0, 4);
}

/** Every command the bar can show as an example, without duplicates. */
export function allExamples(intentsEnabled: boolean): string[] {
	return [
		...new Set<string>([
			...EXAMPLES,
			...ASK_EXAMPLES,
			...(intentsEnabled ? FUND_EXAMPLES : []),
		]),
	];
}

const bigrams = (text: string): Map<string, number> => {
	const clean = ` ${text
		.toLowerCase()
		.replace(/[^a-z0-9$/%. ]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()} `;
	const map = new Map<string, number>();
	for (let i = 0; i < clean.length - 1; i++) {
		const gram = clean.slice(i, i + 2);
		map.set(gram, (map.get(gram) ?? 0) + 1);
	}
	return map;
};

/** Dice coefficient on character pairs: 0 (nothing in common) to 1 (identical). Tolerates typos and word order slips. */
export function similarity(a: string, b: string): number {
	const x = bigrams(a);
	const y = bigrams(b);
	let overlap = 0;
	let total = 0;
	for (const n of x.values()) total += n;
	for (const n of y.values()) total += n;
	for (const [gram, n] of x) overlap += Math.min(n, y.get(gram) ?? 0);
	return total === 0 ? 0 : (2 * overlap) / total;
}

/**
 * "Did you mean": the examples closest to what was typed. Returns nothing when the input is too short or nothing is
 * reasonably close, so a random mistype never produces misleading suggestions.
 */
export function nearestExamples(
	input: string,
	examples: string[],
	count = 3,
	minimum = 0.4,
): string[] {
	if (input.trim().length < 3) return [];
	return examples
		.map((example) => ({ example, score: similarity(input, example) }))
		.filter((item) => item.score >= minimum)
		.sort((a, b) => b.score - a.score)
		.slice(0, count)
		.map((item) => item.example);
}
