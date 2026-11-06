/**
 * Grammar parser for the Solve3 command bar. Pure: text in, a structured intent out. It never touches a wallet,
 * the network or token balances; resolving names and amounts happens in plan.ts with live data, and every intent
 * ends on a page where the user reviews and signs.
 */

export type Amount =
	| { kind: "exact"; value: number }
	| { kind: "all" }
	| { kind: "half" }
	| { kind: "percent"; value: number };

export type PageKey =
	| "swap"
	| "liquidity"
	| "vote"
	| "lock"
	| "rewards"
	| "quests"
	| "pass"
	| "genesis"
	| "charter"
	| "simulator"
	| "bribes"
	| "partners";

export type VoteAllocation = { pool: string; percent: number };

export type Intent =
	| {
			type: "swap";
			amount: Amount | null;
			/** "in": the amount is what you spend; "out": the amount is what you receive ("buy 100 SOLV3 with USDC"). */
			side: "in" | "out";
			from: string | null;
			to: string | null;
	  }
	| { type: "lock"; amount: Amount | null; token: string | null }
	| { type: "vote"; allocations: VoteAllocation[] }
	| { type: "claimAll" }
	| { type: "autoVote"; on: boolean; lockId: number | null }
	| { type: "exitLock"; lockId: number | null }
	| { type: "mergeLocks" }
	| { type: "splitLock"; lockId: number | null }
	| { type: "addLiquidity"; pool: string | null }
	| { type: "addIncentives"; pool: string | null }
	| { type: "mintPass" }
	/** Bring assets from another chain to the Solana wallet (Aurora Intents). Amounts are plain numbers: balances on other chains are not visible. */
	| {
			type: "fund";
			chain: string | null;
			asset: string | null;
			amount: string | null;
			to: string | null;
			address: boolean;
	  }
	/** A read-only question ("What's the SOL price?", "Show my locks"). Answered in the bar; nothing is opened or signed. */
	| { type: "ask"; topic: AskTopic; symbol: string | null }
	| { type: "navigate"; page: PageKey }
	| { type: "help" };

export type AskTopic = "price" | "balance" | "locks" | "epoch";

export type ParseResult =
	| { ok: true; intent: Intent }
	| { ok: false; message: string; suggestions: string[] };

/** Questions the bar answers on the spot. */
export const ASK_EXAMPLES = [
	"What's the SOL price?",
	"What's my balance?",
	"Show my locks",
	"When does the epoch end?",
] as const;

/** Shown only when cross-chain funding is switched on. */
export const FUND_EXAMPLES = [
	"Swap 100 USDC on Base for SOL",
	"Fund 50 USDC from Arbitrum",
	"Fund my wallet from Ethereum",
	"Buy SOL with ETH on Ethereum",
	"Deposit address from Bitcoin",
] as const;

export const EXAMPLES = [
	"Swap 100 USDC for SOLV3",
	"Lock all my SOLV3",
	"Vote 50% SOL/USDC, 50% SOLV3/USDC",
	"Claim all rewards",
	"Turn on auto-vote",
	"Add liquidity to SOL/USDC",
	"Mint my Pass",
	"Go to quests",
] as const;

const PAGE_ALIASES: Record<string, PageKey> = {
	swap: "swap",
	trade: "swap",
	pools: "liquidity",
	pool: "liquidity",
	liquidity: "liquidity",
	positions: "liquidity",
	"my positions": "liquidity",
	"my pools": "liquidity",
	vote: "vote",
	voting: "vote",
	gauges: "vote",
	lock: "lock",
	locks: "lock",
	"my locks": "lock",
	vesolv3: "lock",
	rewards: "rewards",
	"my rewards": "rewards",
	claims: "rewards",
	quests: "quests",
	quest: "quests",
	xp: "quests",
	leaderboard: "quests",
	pass: "pass",
	"my pass": "pass",
	genesis: "genesis",
	charter: "charter",
	docs: "charter",
	"how it works": "charter",
	simulator: "simulator",
	bribes: "bribes",
	incentives: "bribes",
	partners: "partners",
	partner: "partners",
};

const AMOUNT_WORD = /^(all|everything|max|half)$/;
// 100, 1,000, 2.5, .5, 1.5k, 2m, 50%
const AMOUNT_RE = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:k|m)?%?|all|everything|max|half`;
const TOKEN_RE = "[a-z$][a-z0-9.$_-]*";
const POOL_RE = String.raw`[a-z$][a-z0-9.$_-]*\s*[/-]\s*[a-z$][a-z0-9.$_-]*`;
const LOCK_ID_RE = /(?:lock|#|id)\s*#?\s*(\d+)/;

/** Lowercases and removes politeness and possessives so the grammar can stay small. */
export function normalize(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[→⟶]/g, " to ")
			.replace(/->/g, " to ")
			.replace(/[!?.]+$/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.replace(
				/^(please |pls |can you |could you |would you |i want to |i'd like to |i would like to |let me |help me )+/g,
				"",
			)
			.replace(/ (please|pls|for me)$/g, "")
			// "all of my X" / "all my X" -> "all X"
			.replace(/\b(all|half) of (my|the) /g, "$1 ")
			.replace(/\b(all|half) (my|the) /g, "$1 ")
			.replace(/\bmy /g, "")
			.replace(/\bthe /g, "")
			.replace(/\s+/g, " ")
			.trim()
	);
}

export function parseAmount(raw: string): Amount | null {
	const text = raw.trim().replace(/\s+/g, "");
	if (AMOUNT_WORD.test(text)) {
		return text === "half" ? { kind: "half" } : { kind: "all" };
	}
	const match = /^((?:\d[\d,]*(?:\.\d+)?|\.\d+))(k|m)?(%)?$/.exec(text);
	if (!match) return null;
	let value = Number(match[1].replace(/,/g, ""));
	if (!Number.isFinite(value)) return null;
	if (match[2] === "k") value *= 1_000;
	if (match[2] === "m") value *= 1_000_000;
	if (match[3]) {
		if (value <= 0 || value > 100) return null;
		return value === 100
			? { kind: "all" }
			: value === 50
				? { kind: "half" }
				: { kind: "percent", value };
	}
	return value > 0 ? { kind: "exact", value } : null;
}

const cleanPool = (raw: string) => raw.replace(/\s*[/-]\s*/, "/").trim();

function parseLockId(text: string): number | null {
	const match = LOCK_ID_RE.exec(text);
	return match ? Number(match[1]) : null;
}

const CHAIN_WORDS =
	"eth|ethereum|base|arb|arbitrum|btc|bitcoin|near|stellar|xlm|evm|sol|solana";
const PLAIN_NUMBER = String.raw`\d[\d,]*(?:\.\d+)?|\.\d+`;

/**
 * "Swap 100 USDC on Base for SOL", "Fund 50 USDC from Arbitrum", "Fund my wallet from Ethereum",
 * "Buy SOL with ETH on Ethereum", "Deposit address from Bitcoin".
 */
function parseFund(text: string): ParseResult | null {
	// "deposit address [from CHAIN]" first, so "address" is never read as an asset name.
	const addressOnly = new RegExp(
		String.raw`^(?:persistent\s+)?deposit address(?:\s+(?:from|on|with|using)\s+(${CHAIN_WORDS}))?$`,
	).exec(text);
	if (addressOnly) {
		return {
			ok: true,
			intent: {
				type: "fund",
				chain: addressOnly[1] ?? null,
				asset: null,
				amount: null,
				to: null,
				address: true,
			},
		};
	}
	let m = new RegExp(
		String.raw`^(?:swap|trade|convert|exchange|send|bridge|deposit|fund|top up|topup)\s+(?:(?:with|using)\s+)?(?:(${PLAIN_NUMBER}|all|everything|max|half)\s+)?(${TOKEN_RE})\s+(?:on|from)\s+(${CHAIN_WORDS})(?:\s+(?:for|to|into)\s+(${TOKEN_RE}))?$`,
	).exec(text);
	// "fund wallet from Ethereum": "wallet", "account" and "address" are filler words, never an asset.
	if (m && /^(?:wallet|account|address)$/.test(m[2])) m = null;
	if (m) {
		if (m[1] && !/^[\d.]/.test(m[1])) {
			return fail(
				'I cannot see your balance on another chain. Give an amount, like "Swap 100 USDC on Base for SOL".',
				["Swap 100 USDC on Base for SOL"],
			);
		}
		const amount = m[1] ? parseAmount(m[1]) : null;
		if (m[1] && amount?.kind !== "exact")
			return fail(`I couldn't read the amount "${m[1]}".`);
		return {
			ok: true,
			intent: {
				type: "fund",
				chain: m[3],
				asset: m[2],
				amount: amount?.kind === "exact" ? String(amount.value) : null,
				to: m[4] ?? null,
				address: false,
			},
		};
	}
	// "Buy SOL with 25 USDC on Base": what to receive, then what you send from another chain (the amount is what you send).
	const buy = new RegExp(
		String.raw`^(?:buy|get)\s+(${TOKEN_RE})\s+(?:with|using)\s+(?:(${PLAIN_NUMBER})\s+)?(${TOKEN_RE})\s+(?:on|from)\s+(${CHAIN_WORDS})$`,
	).exec(text);
	if (buy) {
		const amount = buy[2] ? parseAmount(buy[2]) : null;
		if (buy[2] && amount?.kind !== "exact")
			return fail(`I couldn't read the amount "${buy[2]}".`);
		return {
			ok: true,
			intent: {
				type: "fund",
				chain: buy[4],
				asset: buy[3],
				amount: amount?.kind === "exact" ? String(amount.value) : null,
				to: buy[1],
				address: false,
			},
		};
	}
	m = new RegExp(
		String.raw`^(?:fund|top up|topup|deposit|bridge)(?:\s+(?:wallet|account|solana|sol))?(?:\s+address)?(?:\s+(?:from|with|using|on)\s+(${CHAIN_WORDS}))?(?:\s+(?:for|to|into)\s+(${TOKEN_RE}))?$`,
	).exec(text);
	if (m) {
		return {
			ok: true,
			intent: {
				type: "fund",
				chain: m[1] ?? null,
				asset: null,
				amount: null,
				to: m[2] ?? null,
				address: /\baddress\b/.test(text),
			},
		};
	}
	return null;
}

/**
 * Read-only questions: "SOL price", "what's my balance", "balance of USDC", "show my locks", "my voting power",
 * "when does the epoch end". Every pattern needs a question word, "my", or the exact topic, so ordinary commands such as
 * "lock all my SOLV3" or "swap 1 sol for usdc" never land here.
 */
function parseAsk(text: string, raw: string): ParseResult | null {
	// normalize() drops "my", so "my locks" and "locks" look the same; the original text tells them apart
	// (a bare "locks" opens the Lock page, as before).
	const mine = /\bmy\b/.test(raw);
	const what = String.raw`(?:what(?:'s|s| is| are)\s+)?`;
	const price =
		new RegExp(
			String.raw`^${what}(?:the\s+)?(?:(?:current|live)\s+)?(?:price of\s+(${TOKEN_RE})|(${TOKEN_RE})\s+price)$`,
		).exec(text) ??
		new RegExp(
			String.raw`^how much is\s+(?:1\s+)?(${TOKEN_RE})(?:\s+worth)?$`,
		).exec(text);
	if (price) {
		return {
			ok: true,
			intent: {
				type: "ask",
				topic: "price",
				symbol: price[1] ?? price[2] ?? null,
			},
		};
	}
	const balance =
		new RegExp(
			String.raw`^${what}(?:my\s+)?(?:wallet\s+)?balances?(?:\s+(?:of|for)\s+(${TOKEN_RE}))?$`,
		).exec(text) ??
		new RegExp(
			String.raw`^how much(?:\s+(${TOKEN_RE}))?\s+do i\s+(?:have|hold|own)$`,
		).exec(text) ??
		/^(?:show|check|view)\s+(?:me\s+)?(?:my\s+)?balances?$/.exec(text);
	if (balance) {
		return {
			ok: true,
			intent: { type: "ask", topic: "balance", symbol: balance[1] ?? null },
		};
	}
	if (
		(mine && /^(?:(?:show|list|view|check)\s+(?:me\s+)?)?locks?$/.test(text)) ||
		(mine &&
			/^what(?:'s|s| is| are)\s+(?:locks?|voting power|lock balance)$/.test(
				text,
			)) ||
		/^voting power$/.test(text) ||
		/^how much (?:solv3\s+)?(?:have i|did i) locked$/.test(text)
	) {
		return { ok: true, intent: { type: "ask", topic: "locks", symbol: null } };
	}
	if (
		/^(?:what(?:'s|s| is)\s+)?(?:the\s+)?(?:current\s+)?epoch$/.test(text) ||
		/^when\s+(?:does|is|will)\s+(?:the\s+)?(?:next\s+)?epoch\s+(?:end|ends|over|flip|flips|change|changes|reset|resets)$/.test(
			text,
		) ||
		/^(?:how long|time)\s+(?:until|till|left)(?:\s+(?:the\s+)?(?:epoch|voting))?(?:\s+(?:ends?|to vote))?$/.test(
			text,
		) ||
		/^time left(?:\s+to vote)?$/.test(text)
	) {
		return { ok: true, intent: { type: "ask", topic: "epoch", symbol: null } };
	}
	return null;
}

function parseSwap(text: string): ParseResult | null {
	// swap|trade|convert|exchange|sell [amount] TOKEN for|to|into TOKEN
	let m = new RegExp(
		String.raw`^(?:swap|trade|convert|exchange|sell)\s+(?:(${AMOUNT_RE})\s+(?:of\s+)?)?(${TOKEN_RE})(?:\s+(?:for|to|into)\s+(${TOKEN_RE}))?$`,
	).exec(text);
	if (m) {
		const amount = m[1] ? parseAmount(m[1]) : null;
		if (m[1] && !amount) return fail(`I couldn't read the amount "${m[1]}".`);
		return {
			ok: true,
			intent: {
				type: "swap",
				amount,
				side: "in",
				from: m[2],
				to: m[3] ?? null,
			},
		};
	}
	// buy [amount] TOKEN with|using [amount] TOKEN
	m = new RegExp(
		String.raw`^buy\s+(?:(${AMOUNT_RE})\s+)?(${TOKEN_RE})(?:\s+(?:with|using|for)\s+(?:(${AMOUNT_RE})\s+)?(${TOKEN_RE}))?$`,
	).exec(text);
	if (m) {
		const outAmount = m[1] ? parseAmount(m[1]) : null;
		const inAmount = m[3] ? parseAmount(m[3]) : null;
		if ((m[1] && !outAmount) || (m[3] && !inAmount))
			return fail("I couldn't read the amount.");
		if (outAmount && inAmount)
			return fail(
				"Give either the amount to buy or the amount to spend, not both.",
			);
		if (outAmount && outAmount.kind !== "exact") {
			return fail(
				`"Buy ${m[1]}" needs a number. Try "Buy 100 SOLV3 with USDC" or "Swap all USDC for SOLV3".`,
			);
		}
		return {
			ok: true,
			intent: {
				type: "swap",
				amount: outAmount ?? inAmount,
				side: outAmount ? "out" : "in",
				from: m[4] ?? null,
				to: m[2],
			},
		};
	}
	return null;
}

function parseLock(text: string): ParseResult | null {
	if (
		/^(exit|unlock|leave|withdraw from|break)\b/.test(text) &&
		/\block\b/.test(text)
	) {
		return {
			ok: true,
			intent: {
				type: "exitLock",
				lockId: parseLockId(text.replace(/^\S+\s+/, "")),
			},
		};
	}
	if (/^merge\b.*\blocks?\b/.test(text))
		return { ok: true, intent: { type: "mergeLocks" } };
	if (/^split\b.*\block\b/.test(text)) {
		return {
			ok: true,
			intent: {
				type: "splitLock",
				lockId: parseLockId(text.replace(/^\S+\s+/, "")),
			},
		};
	}
	// lock [amount] [token]   |   create a lock (of|with) amount [token]
	const m =
		new RegExp(
			String.raw`^lock(?:\s+(?:up\s+)?(${AMOUNT_RE}))?(?:\s+(${TOKEN_RE}))?$`,
		).exec(text) ??
		new RegExp(
			String.raw`^(?:create|make|open)\s+(?:a\s+|new\s+)*lock(?:\s+(?:of|with|for)\s+(${AMOUNT_RE}))?(?:\s+(${TOKEN_RE}))?$`,
		).exec(text);
	if (!m) return null;
	const amount = m[1] ? parseAmount(m[1]) : null;
	if (m[1] && !amount) return fail(`I couldn't read the amount "${m[1]}".`);
	return { ok: true, intent: { type: "lock", amount, token: m[2] ?? null } };
}

function parseVote(text: string): ParseResult | null {
	const m = /^(?:vote|put|give|allocate|split votes?)\s+(.+)$/.exec(text);
	if (!m) return null;
	const body = m[1].replace(/^(?:my\s+)?votes?\s+/, "");
	// "vote for SOL/USDC" / "vote all for SOL/USDC"
	const single = new RegExp(
		String.raw`^(?:(?:all|everything|100%?)\s+)?(?:on|for|to)\s+(${POOL_RE})$`,
	).exec(body);
	if (single)
		return {
			ok: true,
			intent: {
				type: "vote",
				allocations: [{ pool: cleanPool(single[1]), percent: 100 }],
			},
		};
	const parts = body.split(/\s*(?:,|;|\band\b)\s*/).filter(Boolean);
	const allocations: VoteAllocation[] = [];
	for (const part of parts) {
		const a =
			new RegExp(
				String.raw`^(\d+(?:\.\d+)?)\s*%?\s*(?:on|for|to|into)?\s*(${POOL_RE})$`,
			).exec(part) ?? null;
		const b = a
			? null
			: new RegExp(
					String.raw`^(${POOL_RE})\s*(?:at|with|:)?\s*(\d+(?:\.\d+)?)\s*%?$`,
				).exec(part);
		if (a) allocations.push({ pool: cleanPool(a[2]), percent: Number(a[1]) });
		else if (b)
			allocations.push({ pool: cleanPool(b[1]), percent: Number(b[2]) });
		else {
			return fail(
				`I couldn't read "${part}". Write pools as pairs with a slash, like "50% SOL/USDC".`,
				["Vote 50% SOL/USDC, 50% SOLV3/USDC", "Vote all for SOL/USDC"],
			);
		}
	}
	const total = allocations.reduce((sum, item) => sum + item.percent, 0);
	if (allocations.some((item) => item.percent <= 0))
		return fail("Each vote needs a percentage above 0.");
	if (total > 100)
		return fail(`That adds up to ${total}%. Votes can total at most 100%.`);
	return { ok: true, intent: { type: "vote", allocations } };
}

function parseOther(text: string): ParseResult | null {
	if (/^(help|\?|commands|what can (you|i) do.*)$/.test(text))
		return { ok: true, intent: { type: "help" } };
	if (
		/^(claim|collect|harvest)(\s+(all|everything|rewards|all rewards|fees|emissions|all fees))*$/.test(
			text,
		)
	) {
		return { ok: true, intent: { type: "claimAll" } };
	}
	const autoOn =
		/^(turn on|enable|start|switch on|activate|set up|setup)\s+auto[- ]?vot(e|ing)\b/.test(
			text,
		) || /^auto[- ]?vote(\s+on)?(\s|$)/.test(text);
	const autoOff =
		/^(turn off|disable|stop|switch off|deactivate|revoke)\s+auto[- ]?vot(e|ing)\b/.test(
			text,
		) || /^auto[- ]?vote\s+off\b/.test(text);
	if (autoOff || autoOn) {
		return {
			ok: true,
			intent: { type: "autoVote", on: !autoOff, lockId: parseLockId(text) },
		};
	}
	let m =
		new RegExp(
			String.raw`^(?:add|provide|deposit|supply)\s+liquidity(?:\s+(?:to|in|into|for|on)\s+(${POOL_RE}))?$`,
		).exec(text) ??
		new RegExp(String.raw`^lp\s+(?:in|into|to)\s+(${POOL_RE})$`).exec(text);
	if (m)
		return {
			ok: true,
			intent: { type: "addLiquidity", pool: m[1] ? cleanPool(m[1]) : null },
		};
	if (/^(remove|withdraw|manage)\s+liquidity\b/.test(text))
		return { ok: true, intent: { type: "navigate", page: "liquidity" } };
	m = new RegExp(
		String.raw`^(?:add|create|post|offer)\s+(?:an?\s+|some\s+)?(?:incentives?|bribes?)(?:\s+(?:to|for|on)\s+(${POOL_RE}))?$`,
	).exec(text);
	if (m)
		return {
			ok: true,
			intent: { type: "addIncentives", pool: m[1] ? cleanPool(m[1]) : null },
		};
	if (/^(mint|get|claim)\s+(a\s+|new\s+)?(solve3\s+)?pass$/.test(text))
		return { ok: true, intent: { type: "mintPass" } };
	m =
		/^(?:go to|goto|open|show|show me|take me to|navigate to|view|see)?\s*(.+?)(?:\s+page)?$/.exec(
			text,
		);
	if (m && PAGE_ALIASES[m[1]])
		return { ok: true, intent: { type: "navigate", page: PAGE_ALIASES[m[1]] } };
	return null;
}

function fail(
	message: string,
	suggestions: string[] = [...EXAMPLES.slice(0, 4)],
): ParseResult {
	return { ok: false, message, suggestions };
}

export function parseCommand(input: string): ParseResult {
	const text = normalize(input);
	if (!text) return fail("Type what you want to do.");
	const asked = parseAsk(text, input.toLowerCase());
	if (asked) return asked;
	for (const parser of [
		parseFund,
		parseSwap,
		parseLock,
		parseVote,
		parseOther,
	]) {
		const result = parser(text);
		if (result) return result;
	}
	return fail("I don't know that one yet. Try one of these:", [...EXAMPLES]);
}
