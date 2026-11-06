import { describe, expect, test } from "bun:test";
import {
	ASK_EXAMPLES,
	FUND_EXAMPLES,
	normalize,
	parseAmount,
	parseCommand,
} from "./parse";
import {
	type PlanContext,
	planIntent,
	resolveToken,
	SOL_FEE_RESERVE,
} from "./plan";
import { allExamples, nearestExamples, suggestionsFor } from "./suggest";

const intentOf = (text: string) => {
	const res = parseCommand(text);
	if (!res.ok) throw new Error(`expected ok for "${text}": ${res.message}`);
	return res.intent;
};

describe("parseAmount", () => {
	test("numbers, suffixes and commas", () => {
		expect(parseAmount("100")).toEqual({ kind: "exact", value: 100 });
		expect(parseAmount("1.5")).toEqual({ kind: "exact", value: 1.5 });
		expect(parseAmount("1.5k")).toEqual({ kind: "exact", value: 1500 });
		expect(parseAmount("2m")).toEqual({ kind: "exact", value: 2_000_000 });
		expect(parseAmount("1,234,567")).toEqual({ kind: "exact", value: 1234567 });
		expect(parseAmount("0")).toBeNull();
	});
	test("percentages and words", () => {
		expect(parseAmount("50%")).toEqual({ kind: "half" });
		expect(parseAmount("100%")).toEqual({ kind: "all" });
		expect(parseAmount("25%")).toEqual({ kind: "percent", value: 25 });
		expect(parseAmount("150%")).toBeNull();
		expect(parseAmount("everything")).toEqual({ kind: "all" });
		expect(parseAmount("max")).toEqual({ kind: "all" });
		expect(parseAmount("half")).toEqual({ kind: "half" });
	});
});

describe("normalize", () => {
	test("politeness and possessives", () => {
		expect(normalize("Please swap 100 USDC")).toBe("swap 100 usdc");
		expect(normalize("Can you swap 100 USDC for me")).toBe("swap 100 usdc");
		expect(normalize("I want to swap all of my SOLV3")).toBe("swap all solv3");
		expect(normalize("swap the SOLV3!")).toBe("swap solv3");
		expect(normalize("swap SOL → USDC")).toBe("swap sol to usdc");
	});
});

describe("swaps", () => {
	test("spend amounts", () => {
		expect(intentOf("Swap 100 USDC for SOLV3")).toEqual({
			type: "swap",
			amount: { kind: "exact", value: 100 },
			side: "in",
			from: "usdc",
			to: "solv3",
		});
		expect(intentOf("sell all my SOLV3 for SOL")).toEqual({
			type: "swap",
			amount: { kind: "all" },
			side: "in",
			from: "solv3",
			to: "sol",
		});
		expect(intentOf("trade 1.5k sol to usdc")).toEqual({
			type: "swap",
			amount: { kind: "exact", value: 1500 },
			side: "in",
			from: "sol",
			to: "usdc",
		});
		expect(intentOf("swap usdc")).toEqual({
			type: "swap",
			amount: null,
			side: "in",
			from: "usdc",
			to: null,
		});
	});
	test("buy", () => {
		expect(intentOf("buy 100 SOLV3 with USDC")).toEqual({
			type: "swap",
			amount: { kind: "exact", value: 100 },
			side: "out",
			from: "usdc",
			to: "solv3",
		});
		expect(intentOf("buy SOLV3 with 50 USDC")).toEqual({
			type: "swap",
			amount: { kind: "exact", value: 50 },
			side: "in",
			from: "usdc",
			to: "solv3",
		});
		expect(parseCommand("buy all solv3 with usdc").ok).toBe(false);
		expect(parseCommand("buy 5 solv3 with 5 usdc").ok).toBe(false);
	});
});

describe("locks", () => {
	test("create", () => {
		expect(intentOf("Lock all my SOLV3")).toEqual({
			type: "lock",
			amount: { kind: "all" },
			token: "solv3",
		});
		expect(intentOf("lock 500")).toEqual({
			type: "lock",
			amount: { kind: "exact", value: 500 },
			token: null,
		});
		expect(intentOf("create a lock of 1,000 solv3")).toEqual({
			type: "lock",
			amount: { kind: "exact", value: 1000 },
			token: "solv3",
		});
		expect(intentOf("lock half")).toEqual({
			type: "lock",
			amount: { kind: "half" },
			token: null,
		});
		expect(intentOf("lock everything")).toEqual({
			type: "lock",
			amount: { kind: "all" },
			token: null,
		});
	});
	test("manage", () => {
		expect(intentOf("exit lock #3")).toEqual({ type: "exitLock", lockId: 3 });
		expect(intentOf("unlock my lock")).toEqual({
			type: "exitLock",
			lockId: null,
		});
		expect(intentOf("merge my locks")).toEqual({ type: "mergeLocks" });
		expect(intentOf("split lock 2")).toEqual({ type: "splitLock", lockId: 2 });
	});
});

describe("votes", () => {
	test("allocations", () => {
		expect(intentOf("Vote 50% SOL/USDC, 50% SOLV3/USDC")).toEqual({
			type: "vote",
			allocations: [
				{ pool: "sol/usdc", percent: 50 },
				{ pool: "solv3/usdc", percent: 50 },
			],
		});
		expect(intentOf("vote all for sol/usdc")).toEqual({
			type: "vote",
			allocations: [{ pool: "sol/usdc", percent: 100 }],
		});
		expect(intentOf("vote sol-usdc 30% and tsol/usdc 20%")).toEqual({
			type: "vote",
			allocations: [
				{ pool: "sol/usdc", percent: 30 },
				{ pool: "tsol/usdc", percent: 20 },
			],
		});
	});
	test("errors", () => {
		const over = parseCommand("vote sol/usdc 60% and tsol/usdc 50%");
		expect(over.ok).toBe(false);
		if (!over.ok) expect(over.message).toContain("110%");
		expect(parseCommand("vote lots on everything").ok).toBe(false);
	});
});

describe("everything else", () => {
	test("claim", () => {
		for (const text of [
			"claim",
			"claim all",
			"claim rewards",
			"harvest",
			"collect all rewards",
			"Claim everything please",
		]) {
			expect(intentOf(text)).toEqual({ type: "claimAll" });
		}
	});
	test("auto-vote", () => {
		expect(intentOf("turn on auto-vote for lock 4")).toEqual({
			type: "autoVote",
			on: true,
			lockId: 4,
		});
		expect(intentOf("disable autovote")).toEqual({
			type: "autoVote",
			on: false,
			lockId: null,
		});
		expect(intentOf("auto vote off")).toEqual({
			type: "autoVote",
			on: false,
			lockId: null,
		});
		expect(intentOf("autovote")).toEqual({
			type: "autoVote",
			on: true,
			lockId: null,
		});
	});
	test("liquidity, incentives, pass", () => {
		expect(intentOf("add liquidity to SOL/USDC")).toEqual({
			type: "addLiquidity",
			pool: "sol/usdc",
		});
		expect(intentOf("provide liquidity")).toEqual({
			type: "addLiquidity",
			pool: null,
		});
		expect(intentOf("remove liquidity")).toEqual({
			type: "navigate",
			page: "liquidity",
		});
		expect(intentOf("add incentives to sol/usdc")).toEqual({
			type: "addIncentives",
			pool: "sol/usdc",
		});
		expect(intentOf("mint my pass")).toEqual({ type: "mintPass" });
	});
	test("navigation and help", () => {
		expect(intentOf("go to quests")).toEqual({
			type: "navigate",
			page: "quests",
		});
		expect(intentOf("leaderboard")).toEqual({
			type: "navigate",
			page: "quests",
		});
		expect(intentOf("open the vote page")).toEqual({
			type: "navigate",
			page: "vote",
		});
		expect(intentOf("swap")).toEqual({ type: "navigate", page: "swap" });
		expect(intentOf("how it works")).toEqual({
			type: "navigate",
			page: "charter",
		});
		expect(intentOf("help")).toEqual({ type: "help" });
		expect(intentOf("what can you do?")).toEqual({ type: "help" });
	});
	test("unknown", () => {
		const res = parseCommand("make me rich");
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.suggestions.length).toBeGreaterThan(0);
	});
});

const SOL = {
	symbol: "SOL",
	address: "So11111111111111111111111111111111111111112",
	decimals: 9,
};
const SOLV3 = { symbol: "SOLV3", address: "SOLV3mint", decimals: 9 };
const DUSDC = { symbol: "devUSDC", address: "devUSDCmint", decimals: 6 };
const TSOL = { symbol: "tSOL", address: "tSOLmint", decimals: 9 };
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
	tokens: [SOL, SOLV3, DUSDC, TSOL],
	balances: { [SOL.address]: 1.5, [SOLV3.address]: 1000, [DUSDC.address]: 250 },
	locks: [
		{ id: 3, amount: 10 },
		{ id: 7, amount: 500 },
	],
	connected: true,
	solv3Address: SOLV3.address,
	solAddress: SOL.address,
	...over,
});
const plan = (text: string, c = ctx()) => planIntent(intentOf(text), c);

describe("plan", () => {
	test("token aliases", () => {
		expect(resolveToken("solve3", ctx().tokens)).toEqual({ token: SOLV3 });
		expect(resolveToken("USDC", ctx().tokens)).toEqual({ token: DUSDC });
		expect(resolveToken("bonk", ctx().tokens)).toHaveProperty("error");
		// Duplicate symbols: the canonical (first-listed) mint wins.
		const dup = [
			...ctx().tokens,
			{ symbol: "devUSDC", address: "otherUSDC", decimals: 6 },
		];
		expect(resolveToken("usdc", dup)).toEqual({ token: DUSDC });
		// Different symbols sharing only a prefix stay ambiguous.
		expect(resolveToken("s", ctx().tokens)).toHaveProperty("error");
	});
	test("swap href carries mints, amount and side", () => {
		const p = plan("Swap 100 USDC for SOLVE3");
		expect(p.ok && p.href).toBe(
			`/swap?from=${DUSDC.address}&to=${SOLV3.address}&amount=100`,
		);
		const out = plan("buy 20 solv3 with sol");
		expect(out.ok && out.href).toContain("side=out");
	});
	test("all SOL keeps a fee reserve", () => {
		const p = plan("swap all sol for usdc");
		expect(p.ok && p.href).toContain(`amount=${1.5 - SOL_FEE_RESERVE}`);
	});
	test("'all' needs a wallet", () => {
		expect(
			plan("lock all", ctx({ balances: undefined, connected: false })).ok,
		).toBe(false);
		expect(
			plan("lock 50", ctx({ balances: undefined, connected: false })).ok,
		).toBe(true);
	});
	test("lock resolves the balance and only accepts SOLV3", () => {
		const p = plan("Lock all my SOLV3");
		expect(p.ok && p.href).toBe("/lock?amount=1000");
		expect(p.ok && p.warnings[0]).toContain("permanent");
		expect(plan("lock 5 sol").ok).toBe(false);
	});
	test("auto-vote and exit pick the right lock", () => {
		const auto = plan("turn on auto vote");
		expect(auto.ok && auto.href).toBe("/lock/auto-vote?lockId=7");
		expect(auto.ok && auto.warnings[0]).toContain("15%");
		expect(plan("exit lock 9").ok).toBe(false);
		const exit = plan("exit lock 3");
		expect(exit.ok && exit.href).toBe("/lock/exit?lockId=3");
	});
	test("vote encodes normalized pools", () => {
		const p = plan("vote 60% solve3/usdc, 40% sol/usdc");
		expect(p.ok && decodeURIComponent(p.href)).toBe(
			"/arena?alloc=solv3/usdc:60,sol/usdc:40",
		);
	});
	test("help lists examples", () => {
		const p = plan("help");
		expect(p.ok).toBe(false);
		if (!p.ok) expect(p.suggestions).toContain("Lock all my SOLV3");
	});
});

describe("vote prefill helpers", () => {
	test("alloc param round trip and pair matching", async () => {
		const { parseAllocParam, matchesPair } = await import("./plan");
		expect(parseAllocParam("solv3/usdc:60,sol/usdc:40,bad:10,x/y:0")).toEqual([
			{ pool: "solv3/usdc", percent: 60 },
			{ pool: "sol/usdc", percent: 40 },
		]);
		expect(matchesPair("sol/usdc", "SOL", "devUSDC")).toBe(true);
		expect(matchesPair("usdc/sol", "SOL", "devUSDC")).toBe(true);
		expect(matchesPair("solve3/usdc", "SOLV3", "devUSDC")).toBe(true);
		expect(matchesPair("tsol/usdc", "SOL", "devUSDC")).toBe(false);
	});
});

describe("fund commands (cross-chain funding)", () => {
	const on = (over: Partial<PlanContext> = {}) =>
		ctx({ intentsEnabled: true, ...over });
	test("parse", () => {
		expect(intentOf("Swap 100 USDC on Base for SOL")).toEqual({
			type: "fund",
			chain: "base",
			asset: "usdc",
			amount: "100",
			to: "sol",
			address: false,
		});
		expect(intentOf("send 0.5 eth from arbitrum")).toEqual({
			type: "fund",
			chain: "arbitrum",
			asset: "eth",
			amount: "0.5",
			to: null,
			address: false,
		});
		expect(intentOf("Fund my wallet from Ethereum")).toEqual({
			type: "fund",
			chain: "ethereum",
			asset: null,
			amount: null,
			to: null,
			address: false,
		});
		expect(intentOf("fund")).toEqual({
			type: "fund",
			chain: null,
			asset: null,
			amount: null,
			to: null,
			address: false,
		});
		expect(intentOf("deposit address from bitcoin")).toEqual({
			type: "fund",
			chain: "bitcoin",
			asset: null,
			amount: null,
			to: null,
			address: true,
		});
	});
	test("more ways to ask", () => {
		expect(intentOf("Fund 50 USDC from Arbitrum")).toEqual({
			type: "fund",
			chain: "arbitrum",
			asset: "usdc",
			amount: "50",
			to: null,
			address: false,
		});
		expect(intentOf("fund with 0.1 eth on ethereum to sol")).toEqual({
			type: "fund",
			chain: "ethereum",
			asset: "eth",
			amount: "0.1",
			to: "sol",
			address: false,
		});
		expect(intentOf("Buy SOL with ETH on Ethereum")).toEqual({
			type: "fund",
			chain: "ethereum",
			asset: "eth",
			amount: null,
			to: "sol",
			address: false,
		});
		expect(intentOf("get sol with 25 usdc from base")).toEqual({
			type: "fund",
			chain: "base",
			asset: "usdc",
			amount: "25",
			to: "sol",
			address: false,
		});
		const plan = planIntent(intentOf("Fund 50 USDC from Arbitrum"), on());
		expect(plan.ok && plan.href).toBe("/fund?from=arb&asset=USDC&amount=50");
		const buy = planIntent(intentOf("Buy SOL with ETH on Ethereum"), on());
		expect(buy.ok && buy.href).toBe("/fund?from=eth&asset=ETH&to=SOL");
	});
	test("every fund example parses", () => {
		for (const example of FUND_EXAMPLES)
			expect(parseCommand(example).ok).toBe(true);
	});
	test("buy without a chain stays an ordinary swap", () => {
		expect(intentOf("buy sol with usdc").type).toBe("swap");
		expect(intentOf("buy 100 solv3 with usdc").type).toBe("swap");
	});
	test("existing commands are not hijacked", () => {
		expect(intentOf("deposit liquidity to SOL/USDC")).toEqual({
			type: "addLiquidity",
			pool: "sol/usdc",
		});
		expect(intentOf("swap 100 usdc for solv3").type).toBe("swap");
		expect(intentOf("swap usdc for sol").type).toBe("swap");
	});
	test("needs an amount, never a made-up balance", () => {
		const r = parseCommand("swap all usdc on base for sol");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain("balance on another chain");
	});
	test("plan builds the funding link", () => {
		const p = planIntent(intentOf("Swap 100 USDC on Base for SOL"), on());
		expect(p.ok && p.href).toBe("/fund?from=base&asset=USDC&amount=100&to=SOL");
		expect(p.ok && p.warnings).toEqual([]); // the page itself carries the notice; the card stays clean
		const addr = planIntent(intentOf("deposit address from bitcoin"), on());
		expect(addr.ok && addr.href).toBe("/fund?from=btc&tab=address");
		const eth = planIntent(intentOf("fund from ethereum"), on());
		expect(eth.ok && eth.href).toBe("/fund?from=eth");
		expect(planIntent(intentOf("fund"), on()).ok && true).toBe(true);
	});
	test("refuses what it cannot do", () => {
		expect(
			planIntent(intentOf("Swap 100 USDC on Base for SOL"), ctx()).ok,
		).toBe(false); // switched off
		expect(planIntent(intentOf("swap 5 usdc on base for bonk"), on()).ok).toBe(
			false,
		);
		expect(planIntent(intentOf("fund from solana"), on()).ok).toBe(false);
	});
	test("help lists fund examples only when enabled", () => {
		const off = planIntent(intentOf("help"), ctx());
		const onHelp = planIntent(intentOf("help"), on());
		expect(!off.ok && off.suggestions.some((s) => s.includes("on Base"))).toBe(
			false,
		);
		expect(
			!onHelp.ok && onHelp.suggestions.some((s) => s.includes("on Base")),
		).toBe(true);
	});
});

describe("just ask answers (read-only questions)", () => {
	const topicOf = (text: string) => {
		const intent = intentOf(text);
		return intent.type === "ask"
			? `${intent.topic}:${intent.symbol ?? ""}`
			: intent.type;
	};
	test("questions parse", () => {
		expect(topicOf("What's the SOL price?")).toBe("price:sol");
		expect(topicOf("sol price")).toBe("price:sol");
		expect(topicOf("price of usdc")).toBe("price:usdc");
		expect(topicOf("How much is SOL")).toBe("price:sol");
		expect(topicOf("What's my balance?")).toBe("balance:");
		expect(topicOf("balance of USDC")).toBe("balance:usdc");
		expect(topicOf("how much sol do I have")).toBe("balance:sol");
		expect(topicOf("how much do I have")).toBe("balance:");
		expect(topicOf("Show my locks")).toBe("locks:");
		expect(topicOf("what are my locks")).toBe("locks:");
		expect(topicOf("my voting power")).toBe("locks:");
		expect(topicOf("How much have I locked")).toBe("locks:");
		expect(topicOf("When does the epoch end?")).toBe("epoch:");
		expect(topicOf("epoch")).toBe("epoch:");
		expect(topicOf("time left to vote")).toBe("epoch:");
	});
	test("every ask example parses as a question", () => {
		for (const example of ASK_EXAMPLES)
			expect(intentOf(example).type).toBe("ask");
	});
	test("ordinary commands are not hijacked", () => {
		expect(intentOf("Lock all my SOLV3").type).toBe("lock");
		expect(intentOf("swap 1 sol for usdc").type).toBe("swap");
		expect(intentOf("show locks").type).toBe("navigate"); // no "my": opens the page as before
		expect(intentOf("claim all rewards").type).toBe("claimAll");
		expect(intentOf("go to vote").type).toBe("navigate");
		expect(intentOf("buy sol with usdc").type).toBe("swap");
	});
	test("price answers use the live price and never invent one", () => {
		const p = planIntent(
			intentOf("sol price"),
			ctx({ facts: { solUsd: 103.684 } }),
		);
		expect(p.ok && p.answer).toBe(true);
		expect(p.ok && p.title).toBe("SOL is $103.68");
		expect(planIntent(intentOf("sol price"), ctx()).ok).toBe(false);
		expect(
			planIntent(intentOf("sol price"), ctx({ facts: { solUsd: null } })).ok,
		).toBe(false);
		expect(
			planIntent(intentOf("price of bonk"), ctx({ facts: { solUsd: 100 } })).ok,
		).toBe(false);
		const usdc = planIntent(intentOf("usdc price"), ctx());
		expect(usdc.ok && usdc.answer).toBe(true);
	});
	test("balance answers need a connected wallet", () => {
		expect(
			planIntent(intentOf("my balance"), ctx({ connected: false })).ok,
		).toBe(false);
		const all = planIntent(intentOf("my balance"), ctx());
		expect(all.ok && all.lines[0]).toBe("1,000 SOLV3");
		const sol = planIntent(intentOf("balance of sol"), ctx());
		expect(sol.ok && sol.title).toBe("You hold 1.5 SOL");
		const none = planIntent(intentOf("balance of tsol"), ctx());
		expect(none.ok && none.title).toBe("You hold 0 tSOL");
		expect(planIntent(intentOf("balance of nope"), ctx()).ok).toBe(false);
		expect(
			planIntent(intentOf("my balance"), ctx({ balances: undefined })).ok,
		).toBe(false);
	});
	test("lock answers add up the locks", () => {
		const p = planIntent(intentOf("show my locks"), ctx());
		expect(p.ok && p.title).toBe("2 locks, 510 SOLV3");
		expect(p.ok && p.lines).toContain("Lock #7: 500 SOLV3");
		const empty = planIntent(intentOf("show my locks"), ctx({ locks: [] }));
		expect(empty.ok && empty.title).toBe("You have no locks yet");
		expect(
			planIntent(intentOf("show my locks"), ctx({ connected: false })).ok,
		).toBe(false);
		expect(
			planIntent(intentOf("show my locks"), ctx({ locks: undefined })).ok,
		).toBe(false);
	});
	test("epoch answers", () => {
		const open = planIntent(
			intentOf("when does the epoch end"),
			ctx({
				facts: {
					epoch: {
						number: 3,
						state: "open",
						remainingSeconds: 5 * 86400 + 4 * 3600,
					},
				},
			}),
		);
		expect(open.ok && open.title).toBe("Epoch 3");
		expect(open.ok && open.lines[0]).toContain("5d 4h");
		expect(planIntent(intentOf("epoch"), ctx()).ok).toBe(false);
	});
});

describe("just ask suggestions", () => {
	test("personal suggestions follow what the wallet has", () => {
		const rich = suggestionsFor(ctx());
		expect(rich).toContain("Lock all my SOLV3");
		expect(rich).toContain("Show my locks");
		expect(rich.length).toBeLessThanOrEqual(4);
		const fresh = suggestionsFor(
			ctx({ balances: { [SOL.address]: 2 }, locks: [] }),
		);
		expect(fresh).not.toContain("Lock all my SOLV3");
		expect(fresh).toContain("Swap 0.1 SOL for SOLV3");
		const off = suggestionsFor(ctx({ connected: false }));
		expect(off).toEqual(["What's the SOL price?"]);
	});
	test("every suggestion is something the bar understands", () => {
		for (const text of [
			...suggestionsFor(
				ctx({
					facts: {
						epoch: { number: 1, state: "open", remainingSeconds: 3600 },
					},
				}),
			),
			...allExamples(true),
		])
			expect(parseCommand(text).ok).toBe(true);
	});
	test("did you mean tolerates typos and ignores nonsense", () => {
		const examples = allExamples(true);
		expect(nearestExamples("swap 100 usdc for solv", examples)[0]).toBe(
			"Swap 100 USDC for SOLV3",
		);
		expect(nearestExamples("calim all rewards", examples)[0]).toBe(
			"Claim all rewards",
		);
		expect(nearestExamples("qqqzzzxxx", examples)).toEqual([]);
		expect(nearestExamples("ab", examples)).toEqual([]);
	});
});
