import { INTENTS_DESTINATION_SYMBOLS } from "@/configs/intents";
import { resolveChain } from "@/lib/intents/chains";
import {
	type Amount,
	ASK_EXAMPLES,
	EXAMPLES,
	FUND_EXAMPLES,
	type Intent,
	type PageKey,
} from "./parse";

/**
 * Turns a parsed intent into a plan the user can review: what will happen, what to watch out for, and the page that
 * finishes it. Nothing here signs or sends anything; the destination page shows its own quote or simulation and the
 * wallet asks for approval there.
 */

export type CommandToken = {
	symbol: string;
	address: string;
	decimals: number;
};
export type CommandLock = { id: number; amount: number };

export type PlanContext = {
	tokens: CommandToken[];
	/** UI-unit balances by mint address; undefined when no wallet is connected or balances are still loading. */
	balances?: Record<string, number>;
	locks?: CommandLock[];
	connected: boolean;
	/** Mint address of SOLV3 (the only lockable token). */
	solv3Address: string;
	/** Mint address treated as SOL (native). */
	solAddress: string;
	/** Cross-chain funding (Aurora Intents) is switched on. */
	intentsEnabled?: boolean;
	/** Live facts for read-only questions; a missing value means "not available right now". */
	facts?: {
		solUsd?: number | null;
		epoch?: {
			number: number;
			state: "open" | "final-hour" | "settling" | "settled";
			remainingSeconds: number;
		} | null;
	};
};

export type Plan =
	| {
			ok: true;
			title: string;
			lines: string[];
			warnings: string[];
			href: string;
			cta: string;
			/** A read-only answer: nothing will be sent or signed, the button just opens the related page. */
			answer?: boolean;
	  }
	| {
			ok: false;
			message: string;
			suggestions: string[];
			/** The suggestions are the closest known commands to what was typed. */
			didYouMean?: boolean;
	  };

/** SOL kept back when "all" SOL is swapped, so the wallet can still pay transaction fees. */
export const SOL_FEE_RESERVE = 0.02;

const PAGE_PATHS: Record<PageKey, { path: string; label: string }> = {
	swap: { path: "/swap", label: "Swap" },
	liquidity: { path: "/liquidity", label: "Pools" },
	vote: { path: "/arena", label: "Arena" },
	lock: { path: "/lock", label: "Lock" },
	rewards: { path: "/rewards", label: "Rewards" },
	quests: { path: "/quests", label: "Quests" },
	pass: { path: "/pass", label: "Pass" },
	genesis: { path: "/genesis", label: "Genesis" },
	charter: { path: "/charter", label: "Charter" },
	simulator: { path: "/simulator", label: "Simulator" },
	bribes: { path: "/bribes", label: "Incentives" },
	partners: { path: "/partners", label: "Partners" },
};

const TOKEN_ALIASES: Record<string, string> = {
	solve3: "solv3",
	solve: "solv3",
	solv: "solv3",
	slv: "solv3",
	$solv3: "solv3",
	usd: "usdc",
	$usdc: "usdc",
	$sol: "sol",
	wsol: "sol",
	solana: "sol",
};

const short = (address: string) =>
	`${address.slice(0, 4)}…${address.slice(-4)}`;

const fmt = (value: number) =>
	value.toLocaleString("en-US", { maximumFractionDigits: value >= 1 ? 4 : 8 });

/** Name -> token. "usdc" also finds "devUSDC" on devnet; ambiguous names are reported, never guessed. */
export function resolveToken(
	query: string,
	tokens: CommandToken[],
): { token: CommandToken } | { error: string } {
	const raw = query.toLowerCase().replace(/^\$/, "");
	const q = TOKEN_ALIASES[raw] ?? TOKEN_ALIASES[query.toLowerCase()] ?? raw;
	const exact = tokens.filter((t) => t.symbol.toLowerCase() === q);
	// Several tokens can share a symbol (the app's own mints plus older list entries). The first listed wins: callers
	// put the canonical mints, the ones the Swap and Lock pages use, first. The card always shows which mint it is.
	if (exact.length >= 1) return { token: exact[0] };
	const dev = tokens.filter((t) => t.symbol.toLowerCase() === `dev${q}`);
	if (dev.length >= 1) return { token: dev[0] };
	const pool = tokens.filter((t) => t.symbol.toLowerCase().startsWith(q));
	const unique = [...new Map(pool.map((t) => [t.address, t])).values()];
	if (unique.length === 1) return { token: unique[0] };
	if (unique.length > 1) {
		return {
			error: `"${query}" matches ${unique
				.map((t) => t.symbol)
				.slice(0, 4)
				.join(", ")}. Which one?`,
		};
	}
	return { error: `I couldn't find a token called "${query}".` };
}

/** "SOL/USDC" with aliases applied ("solve3/usdc" -> "solv3/usdc"); matching against real pools happens on the page. */
export function normalizePool(pool: string): string {
	return pool
		.split("/")
		.map((side) => TOKEN_ALIASES[side.toLowerCase()] ?? side.toLowerCase())
		.join("/");
}

export function resolveAmount(
	amount: Amount,
	balance: number | undefined,
	isSol: boolean,
): { value: number; note?: string } | { error: string } {
	if (amount.kind === "exact") return { value: amount.value };
	if (balance === undefined)
		return { error: "Connect your wallet so I can read your balance." };
	const spendable = isSol ? Math.max(0, balance - SOL_FEE_RESERVE) : balance;
	const factor =
		amount.kind === "all"
			? 1
			: amount.kind === "half"
				? 0.5
				: amount.value / 100;
	const value = Math.floor(spendable * factor * 1e6) / 1e6;
	if (!(value > 0)) return { error: "You don't have any to use." };
	const note =
		isSol && amount.kind === "all"
			? `${SOL_FEE_RESERVE} SOL is kept back for fees.`
			: undefined;
	return { value, note };
}

const ok = (
	title: string,
	lines: string[],
	warnings: string[],
	href: string,
	cta: string,
): Plan => ({
	ok: true,
	title,
	lines,
	warnings,
	href,
	cta,
});
const answer = (
	title: string,
	lines: string[],
	href: string,
	cta: string,
): Plan => ({ ok: true, title, lines, warnings: [], href, cta, answer: true });

/** "5d 4h", "3h 12m", "7m": a short span for answers (the header clock shows the exact countdown). */
export function formatSpan(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${Math.max(1, m)}m`;
}

const amountText = (value: number) =>
	value >= 1000
		? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
		: String(Number(value.toPrecision(6)));

const no = (message: string, suggestions: string[] = []): Plan => ({
	ok: false,
	message,
	suggestions,
});

function pickLock(
	lockId: number | null,
	ctx: PlanContext,
): { lock?: CommandLock; note?: string; error?: string } {
	if (lockId !== null) {
		const lock = ctx.locks?.find((l) => l.id === lockId);
		return lock || !ctx.locks
			? { lock: lock ?? { id: lockId, amount: 0 } }
			: { error: `You don't have lock #${lockId}.` };
	}
	if (!ctx.locks) return { note: "Pick the lock on the next page." };
	if (ctx.locks.length === 0)
		return { error: 'You don\'t have a lock yet. Try "Lock all my SOLV3".' };
	if (ctx.locks.length === 1) return { lock: ctx.locks[0] };
	const largest = [...ctx.locks].sort((a, b) => b.amount - a.amount)[0];
	return {
		lock: largest,
		note: `You have ${ctx.locks.length} locks; using your largest, #${largest.id}. Name another with "lock #N".`,
	};
}

export function planIntent(intent: Intent, ctx: PlanContext): Plan {
	switch (intent.type) {
		case "help":
			return no("Here is what I can do. Click one to try it:", [
				...EXAMPLES,
				...ASK_EXAMPLES,
				...(ctx.intentsEnabled ? FUND_EXAMPLES : []),
			]);

		case "ask": {
			if (intent.topic === "price") {
				const symbol = (intent.symbol ?? "sol").toUpperCase();
				if (symbol === "USDC")
					return answer(
						"USDC price",
						["USDC is about $1.00."],
						"/swap",
						"Open Swap",
					);
				if (symbol !== "SOL" && symbol !== "SOLANA") {
					return no("I can quote SOL and USDC for now.", [
						"What's the SOL price?",
					]);
				}
				const usd = ctx.facts?.solUsd;
				if (!usd || usd <= 0)
					return no(
						"I can't read the SOL price right now. Try again in a moment.",
					);
				return answer(
					`SOL is $${usd.toFixed(2)}`,
					["Spot price from Coinbase, refreshed about every minute."],
					"/swap",
					"Open Swap",
				);
			}
			if (intent.topic === "balance") {
				if (!ctx.connected)
					return no("Connect your wallet to see your balance.");
				if (!ctx.balances)
					return no("Still loading your balances. Try again in a second.");
				if (intent.symbol) {
					const wanted = intent.symbol.toLowerCase();
					const token = ctx.tokens.find(
						(t) => t.symbol.toLowerCase() === wanted,
					);
					if (!token)
						return no(`I don't know a token called "${intent.symbol}".`, [
							"What's my balance?",
						]);
					const held = ctx.balances[token.address] ?? 0;
					return answer(
						`You hold ${amountText(held)} ${token.symbol}`,
						held > 0 ? [] : [`Your wallet has no ${token.symbol} right now.`],
						"/swap",
						"Open Swap",
					);
				}
				const held = ctx.tokens
					.map((t) => ({
						symbol: t.symbol,
						amount: ctx.balances?.[t.address] ?? 0,
					}))
					.filter((t) => t.amount > 0)
					.sort((a, b) => b.amount - a.amount)
					.slice(0, 6);
				if (held.length === 0)
					return answer(
						"Your wallet is empty",
						["No tokens found in this wallet yet."],
						"/swap",
						"Open Swap",
					);
				return answer(
					"Your balances",
					held.map((t) => `${amountText(t.amount)} ${t.symbol}`),
					"/swap",
					"Open Swap",
				);
			}
			if (intent.topic === "locks") {
				if (!ctx.connected) return no("Connect your wallet to see your locks.");
				if (!ctx.locks)
					return no("Still loading your locks. Try again in a second.");
				if (ctx.locks.length === 0)
					return answer(
						"You have no locks yet",
						["Lock SOLV3 to earn voting power and rewards."],
						"/lock",
						"Open Lock",
					);
				const total = ctx.locks.reduce((sum, l) => sum + l.amount, 0);
				return answer(
					`${ctx.locks.length} ${ctx.locks.length === 1 ? "lock" : "locks"}, ${amountText(total)} SOLV3`,
					[
						...ctx.locks
							.slice(0, 5)
							.map((l) => `Lock #${l.id}: ${amountText(l.amount)} SOLV3`),
						...(ctx.locks.length > 5
							? [`and ${ctx.locks.length - 5} more`]
							: []),
						"Voting power grows with lock time; the Vote page shows the exact figure.",
					],
					"/arena",
					"Open Vote",
				);
			}
			const epoch = ctx.facts?.epoch;
			if (!epoch) return no("Epoch timing isn't available on this network.");
			const state =
				epoch.state === "open"
					? [
							`Voting is open. Final vote in about ${formatSpan(epoch.remainingSeconds)}.`,
						]
					: epoch.state === "final-hour"
						? [
								`Voting is closed. The epoch ends in about ${formatSpan(epoch.remainingSeconds)}.`,
							]
						: ["The epoch is being settled; the new one opens shortly."];
			return answer(`Epoch ${epoch.number}`, state, "/arena", "Open Vote");
		}

		case "navigate": {
			const page = PAGE_PATHS[intent.page];
			return ok(`Open ${page.label}`, [], [], page.path, `Go to ${page.label}`);
		}

		case "swap": {
			if (!intent.from && !intent.to)
				return no('Which tokens? Try "Swap 100 USDC for SOLV3".');
			if (!intent.to)
				return no(
					`Swap ${intent.from?.toUpperCase()} for what? Try "Swap 100 USDC for SOLV3".`,
				);
			if (!intent.from)
				return no(
					`Buy ${intent.to.toUpperCase()} with what? Try "Buy 100 SOLV3 with USDC".`,
				);
			const from = resolveToken(intent.from, ctx.tokens);
			if ("error" in from) return no(from.error);
			const to = resolveToken(intent.to, ctx.tokens);
			if ("error" in to) return no(to.error);
			if (from.token.address === to.token.address)
				return no("Pick two different tokens.");
			const params = new URLSearchParams({
				from: from.token.address,
				to: to.token.address,
			});
			const lines: string[] = [];
			if (intent.amount) {
				const amountToken = intent.side === "out" ? to.token : from.token;
				const resolved = resolveAmount(
					intent.amount,
					ctx.balances?.[amountToken.address],
					amountToken.address === ctx.solAddress,
				);
				if ("error" in resolved) return no(resolved.error);
				params.set("amount", String(resolved.value));
				if (intent.side === "out") params.set("side", "out");
				lines.push(
					intent.side === "out"
						? `Buy ${fmt(resolved.value)} ${to.token.symbol}, paying with ${from.token.symbol}`
						: `Spend ${fmt(resolved.value)} ${from.token.symbol} for ${to.token.symbol}`,
				);
				if (resolved.note) lines.push(resolved.note);
			} else {
				lines.push(
					`${from.token.symbol} -> ${to.token.symbol}; enter the amount on the Swap page.`,
				);
			}
			lines.push(
				`Tokens: ${from.token.symbol} (${short(from.token.address)}) -> ${to.token.symbol} (${short(to.token.address)})`,
				"The Swap page shows the live quote, price impact and slippage before you sign.",
			);
			return ok(
				`Swap ${from.token.symbol} for ${to.token.symbol}`,
				lines,
				[],
				`/swap?${params}`,
				"Review swap",
			);
		}

		case "lock": {
			if (intent.token) {
				const t = resolveToken(intent.token, ctx.tokens);
				if (!("token" in t) || t.token.address !== ctx.solv3Address)
					return no("Only SOLV3 can be locked.");
			}
			const warnings = [
				"Locks are permanent: veSOLV3 does not unlock on its own. Leaving a lock later returns your SOLV3 and costs SOL.",
			];
			if (!intent.amount)
				return ok(
					"Lock SOLV3",
					["Enter the amount on the Lock page."],
					warnings,
					"/lock",
					"Open Lock",
				);
			const resolved = resolveAmount(
				intent.amount,
				ctx.balances?.[ctx.solv3Address],
				false,
			);
			if ("error" in resolved) return no(resolved.error);
			return ok(
				`Lock ${fmt(resolved.value)} SOLV3`,
				[
					`You get ${fmt(resolved.value)} veSOLV3 voting power (1 SOLV3 = 1 veSOLV3).`,
					"The Lock page simulates the transaction before you sign.",
				],
				warnings,
				`/lock?amount=${resolved.value}`,
				"Review lock",
			);
		}

		case "vote": {
			const pools = intent.allocations.map((a) => ({
				...a,
				pool: normalizePool(a.pool),
			}));
			const total = pools.reduce((sum, a) => sum + a.percent, 0);
			const alloc = pools.map((a) => `${a.pool}:${a.percent}`).join(",");
			return ok(
				"Set your votes",
				[
					...pools.map((a) => `${a.percent}% to ${a.pool.toUpperCase()}`),
					total < 100
						? `${100 - total}% stays unallocated.`
						: "100% allocated.",
					"The Vote page fills these in; you cast the vote there.",
				],
				["Casting replaces this lock's whole allocation for the epoch."],
				`/arena?alloc=${encodeURIComponent(alloc)}`,
				"Review votes",
			);
		}

		case "claimAll":
			return ok(
				"Claim all rewards",
				[
					"LP fees and rewards for every position, plus voting rewards (SOLV3, pool fees and incentives).",
					"Your wallet may ask for several approvals.",
				],
				[],
				"/rewards?focus=claim-all",
				"Go to Claim All",
			);

		case "autoVote": {
			const pick = pickLock(intent.lockId, ctx);
			if (pick.error) return no(pick.error);
			const lines = [
				pick.lock
					? `Lock #${pick.lock.id}`
					: "Choose your lock on the next page.",
			];
			if (pick.note) lines.push(pick.note);
			return ok(
				intent.on ? "Turn on Auto-Vote" : "Turn off Auto-Vote",
				lines,
				intent.on
					? [
							"Auto-Vote charges 15% of the rewards it votes for you. Voting yourself is always free.",
						]
					: [],
				pick.lock ? `/lock/auto-vote?lockId=${pick.lock.id}` : "/lock",
				intent.on ? "Review Auto-Vote" : "Review",
			);
		}

		case "exitLock": {
			const pick = pickLock(intent.lockId, ctx);
			if (pick.error) return no(pick.error);
			return ok(
				pick.lock ? `Exit lock #${pick.lock.id}` : "Exit a lock",
				[
					pick.note ??
						"The Exit page shows the exact SOL cost before you sign.",
				],
				[
					"Exiting returns your SOLV3 principal and costs SOL at the published exit rate. It ends this lock's voting power.",
				],
				pick.lock ? `/lock/exit?lockId=${pick.lock.id}` : "/lock",
				"Review exit",
			);
		}

		case "mergeLocks":
			return ok(
				"Merge locks",
				["Choose the two locks on the Merge page."],
				[],
				"/lock/merge",
				"Open Merge",
			);

		case "splitLock": {
			const pick = pickLock(intent.lockId, ctx);
			return ok(
				pick.lock ? `Split lock #${pick.lock.id}` : "Split a lock",
				["Choose the amount on the Split page."],
				[],
				pick.lock ? `/lock/split?lockId=${pick.lock.id}` : "/lock/split",
				"Open Split",
			);
		}

		case "addLiquidity": {
			const pool = intent.pool ? normalizePool(intent.pool) : null;
			return ok(
				pool ? `Add liquidity to ${pool.toUpperCase()}` : "Add liquidity",
				[
					pool
						? "Pools is filtered to this pair; pick the pool and range there."
						: "Pick a pool and range on Pools.",
				],
				["Emissions only pay while your position is in range."],
				pool ? `/liquidity?q=${encodeURIComponent(pool)}` : "/liquidity",
				"Open Pools",
			);
		}

		case "addIncentives":
			return ok(
				intent.pool
					? `Add incentives to ${normalizePool(intent.pool).toUpperCase()}`
					: "Add incentives",
				["Choose the pool, token and amount on the Incentives page."],
				["Incentives do not guarantee votes, emissions or liquidity."],
				"/bribes",
				"Open Incentives",
			);

		case "fund": {
			if (!ctx.intentsEnabled)
				return no("Funding from other chains is not switched on yet.");
			const chain = intent.chain ? resolveChain(intent.chain) : null;
			if (intent.chain && !chain)
				return no(
					`I don't know the chain "${intent.chain}". Try Base, Ethereum, Arbitrum, Bitcoin or NEAR.`,
				);
			if (chain?.slug === "sol")
				return no("That is already Solana. Use Swap instead.");
			const toRaw = (intent.to ?? "").toUpperCase().replace(/^SOLANA$/, "SOL");
			if (
				intent.to &&
				!(INTENTS_DESTINATION_SYMBOLS as readonly string[]).includes(toRaw)
			) {
				return no("You can receive SOL or USDC on Solana.", [
					"Swap 100 USDC on Base for SOL",
					"Fund my wallet from Ethereum",
				]);
			}
			const params = new URLSearchParams();
			if (chain) params.set("from", chain.slug);
			if (intent.asset && !intent.address)
				params.set("asset", intent.asset.toUpperCase());
			if (intent.amount && !intent.address) params.set("amount", intent.amount);
			if (toRaw) params.set("to", toRaw);
			if (intent.address) params.set("tab", "address");
			const query = params.toString();
			const lines = [
				intent.address
					? `A reusable deposit address${chain ? ` for ${chain.label}` : ""}. Anything you send to it arrives in your Solana wallet${toRaw ? ` as ${toRaw}` : ""}.`
					: intent.amount && intent.asset
						? `Send ${intent.amount} ${intent.asset.toUpperCase()}${chain ? ` from ${chain.label}` : ""} and receive ${toRaw || "SOL or USDC"} on Solana.`
						: "Pick what to send and how much; you will see the price and a one-time address.",
				"The next page shows the quote, fees and your refund address. Nothing is sent from here.",
			];
			return ok(
				intent.address ? "Get a deposit address" : "Fund from another chain",
				lines,
				[],
				`/fund${query ? `?${query}` : ""}`,
				intent.address ? "Get my address" : "Review funding",
			);
		}

		case "mintPass":
			return ok(
				"Mint your Solve3 Pass",
				["One Pass per wallet. Minting is free and earns XP."],
				[],
				"/pass",
				"Open Pass",
			);
	}
}

/** "sol/usdc:50,solv3/usdc:50" -> allocations (the /vote?alloc= format written by planIntent). */
export function parseAllocParam(
	value: string,
): { pool: string; percent: number }[] {
	return value
		.split(",")
		.map((part) => {
			const [pool, percent] = part.split(":");
			return { pool: (pool ?? "").trim(), percent: Number(percent) };
		})
		.filter(
			(item) =>
				item.pool.includes("/") &&
				Number.isFinite(item.percent) &&
				item.percent > 0 &&
				item.percent <= 100,
		);
}

/** Does "sol/usdc" name the pool with these two symbols? Either order; "usdc" also matches "devUSDC". */
export function matchesPair(
	query: string,
	symbolA: string,
	symbolB: string,
): boolean {
	const bare = (s: string) => {
		const lower = s.toLowerCase();
		const aliased = TOKEN_ALIASES[lower] ?? lower;
		return aliased.startsWith("dev") ? aliased.slice(3) : aliased;
	};
	const [x, y] = query.split("/").map(bare);
	const a = bare(symbolA);
	const b = bare(symbolB);
	return (x === a && y === b) || (x === b && y === a);
}
