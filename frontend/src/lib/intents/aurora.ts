import { PublicKey } from "@solana/web3.js";
import {
	INTENTS_DEFAULT_SLIPPAGE_BPS,
	INTENTS_DESTINATION_SYMBOLS,
	INTENTS_MAX_SLIPPAGE_BPS,
	SOLANA_CHAIN,
} from "@/configs/intents";

/** Shapes follow Aurora's Swap API reference (POST /api/quote/{key}, GET /api/status/{key}). Only fields we use. */
export type AuroraToken = {
	assetId: string;
	decimals: number;
	blockchain: string;
	symbol: string;
	price?: number | null;
	contractAddress?: string;
};

export type QuoteInput = {
	originAsset: string;
	destinationAsset: string;
	/** Smallest unit of the origin asset (EXACT_INPUT). */
	amount: string;
	/** A Solana address: where the swapped funds arrive. */
	recipient: string;
	/** An address on the ORIGIN chain: where an unfinished or failed swap is refunded. */
	refundTo: string;
	slippageBps?: number;
	/** true: price it without reserving a deposit address. */
	dry: boolean;
};

export type QuoteRequestBody = {
	dry: boolean;
	swapType: "EXACT_INPUT";
	depositType: "ORIGIN_CHAIN";
	amount: string;
	originAsset: string;
	destinationAsset: string;
	slippageTolerance: number;
	refundTo: string;
	refundType: "ORIGIN_CHAIN";
	recipient: string;
	recipientType: "DESTINATION_CHAIN";
};

export function isSolanaAddress(value: string): boolean {
	try {
		const key = new PublicKey(value);
		return key.toBase58() === value;
	} catch {
		return false;
	}
}

export type Validation =
	| { ok: true; body: QuoteRequestBody }
	| { ok: false; error: string };

/**
 * Checks a quote request against the live token list and builds the exact body Aurora expects. The server calls this
 * before every quote so a browser cannot ask the proxy for arbitrary assets, destinations or recipients.
 */
export function buildQuoteRequest(
	input: QuoteInput,
	tokens: AuroraToken[],
): Validation {
	const origin = tokens.find((t) => t.assetId === input.originAsset);
	const destination = tokens.find((t) => t.assetId === input.destinationAsset);
	if (!origin) return { ok: false, error: "Unknown source asset." };
	if (!destination) return { ok: false, error: "Unknown destination asset." };
	if (
		destination.blockchain !== SOLANA_CHAIN ||
		!(INTENTS_DESTINATION_SYMBOLS as readonly string[]).includes(
			destination.symbol,
		)
	) {
		return { ok: false, error: "You can receive SOL or USDC on Solana." };
	}
	if (origin.assetId === destination.assetId)
		return { ok: false, error: "Pick a different source asset." };
	if (!/^[1-9]\d*$/.test(input.amount))
		return { ok: false, error: "Enter an amount above zero." };
	if (!isSolanaAddress(input.recipient))
		return { ok: false, error: "Connect a Solana wallet to receive funds." };
	if (!input.refundTo.trim() || input.refundTo.length > 128) {
		return {
			ok: false,
			error: `Add your ${origin.blockchain.toUpperCase()} address for refunds.`,
		};
	}
	const slippage = input.slippageBps ?? INTENTS_DEFAULT_SLIPPAGE_BPS;
	if (
		!Number.isInteger(slippage) ||
		slippage < 1 ||
		slippage > INTENTS_MAX_SLIPPAGE_BPS
	) {
		return {
			ok: false,
			error: `Slippage must be between 0.01% and ${INTENTS_MAX_SLIPPAGE_BPS / 100}%.`,
		};
	}
	return {
		ok: true,
		body: {
			dry: input.dry,
			swapType: "EXACT_INPUT",
			depositType: "ORIGIN_CHAIN",
			amount: input.amount,
			originAsset: origin.assetId,
			destinationAsset: destination.assetId,
			slippageTolerance: slippage,
			refundTo: input.refundTo.trim(),
			refundType: "ORIGIN_CHAIN",
			recipient: input.recipient,
			recipientType: "DESTINATION_CHAIN",
		},
	};
}

/** Source tokens worth offering: not Solana (that is a normal swap), has a price, sorted by symbol. */
/** Assets people most often hold, in the order they are offered. Everything else follows alphabetically. */
export const POPULAR_SOURCE_SYMBOLS = [
	"USDC",
	"USDT",
	"ETH",
	"BTC",
	"NEAR",
	"XLM",
] as const;

const popularRank = (symbol: string) => {
	const i = POPULAR_SOURCE_SYMBOLS.indexOf(
		symbol.toUpperCase() as (typeof POPULAR_SOURCE_SYMBOLS)[number],
	);
	return i === -1 ? POPULAR_SOURCE_SYMBOLS.length : i;
};

export const isPopularSource = (token: AuroraToken) =>
	popularRank(token.symbol) < POPULAR_SOURCE_SYMBOLS.length;

export function sourceTokens(
	tokens: AuroraToken[],
	chainSlug: string,
): AuroraToken[] {
	return tokens
		.filter((t) => t.blockchain === chainSlug && chainSlug !== SOLANA_CHAIN)
		.sort(
			(a, b) =>
				popularRank(a.symbol) - popularRank(b.symbol) ||
				a.symbol.localeCompare(b.symbol),
		);
}

export function destinationTokens(tokens: AuroraToken[]): AuroraToken[] {
	return INTENTS_DESTINATION_SYMBOLS.flatMap((symbol) =>
		tokens
			.filter((t) => t.blockchain === SOLANA_CHAIN && t.symbol === symbol)
			.slice(0, 1),
	);
}

// ---------------------------------------------------------------- status wording

export type SwapStatus =
	| "PENDING_DEPOSIT"
	| "KNOWN_DEPOSIT_TX"
	| "INCOMPLETE_DEPOSIT"
	| "PROCESSING"
	| "SUCCESS"
	| "REFUNDED"
	| "FAILED";

export type StatusView = {
	phase: "waiting" | "working" | "done" | "attention";
	title: string;
	detail: string;
	/** Polling can stop. */
	final: boolean;
	/** 1-4 position for a progress rail: waiting, seen, swapping, arrived. */
	step: 1 | 2 | 3 | 4;
};

export function describeStatus(
	status: string,
	refundReason?: string,
): StatusView {
	switch (status) {
		case "PENDING_DEPOSIT":
			return {
				phase: "waiting",
				title: "Waiting for your deposit",
				detail:
					"Send the exact amount from your other wallet to the address above.",
				final: false,
				step: 1,
			};
		case "KNOWN_DEPOSIT_TX":
			return {
				phase: "working",
				title: "Deposit seen",
				detail: "Your transfer was detected and is being confirmed.",
				final: false,
				step: 2,
			};
		case "PROCESSING":
			return {
				phase: "working",
				title: "Swapping and sending",
				detail: "Aurora is routing your funds to your Solana wallet.",
				final: false,
				step: 3,
			};
		case "SUCCESS":
			return {
				phase: "done",
				title: "Arrived in your Solana wallet",
				detail: "The swap is complete.",
				final: true,
				step: 4,
			};
		case "INCOMPLETE_DEPOSIT":
			return {
				phase: "attention",
				title: "Deposit too small",
				detail:
					"Less than the quoted amount arrived. It is refunded to your refund address when the quote expires.",
				final: false,
				step: 2,
			};
		case "REFUNDED":
			return {
				phase: "attention",
				title: "Refunded",
				detail: refundReason
					? `Your funds were returned: ${refundReason}.`
					: "Your funds were returned to your refund address.",
				final: true,
				step: 4,
			};
		case "FAILED":
			return {
				phase: "attention",
				title: "Swap failed",
				detail:
					"Check your refund address; unfinished deposits are returned there.",
				final: true,
				step: 4,
			};
		default:
			return {
				phase: "waiting",
				title: "Checking status",
				detail: "One moment.",
				final: false,
				step: 1,
			};
	}
}

/** Seconds until a deadline (ISO string), never negative; null when missing or unparseable. */
export function secondsUntil(
	deadline: string | undefined,
	now = Date.now(),
): number | null {
	if (!deadline) return null;
	const at = Date.parse(deadline);
	return Number.isFinite(at)
		? Math.max(0, Math.floor((at - now) / 1000))
		: null;
}
