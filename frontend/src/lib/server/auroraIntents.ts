import "server-only";
import { AURORA_INTENTS_API_BASE } from "@/configs/intents";
import type { AuroraToken } from "@/lib/intents/aurora";

/**
 * Server-side client for Aurora Intents. The API key goes in the URL path (Aurora's design) and is read from
 * AURORA_INTENTS_API_KEY; the browser only ever talks to our /api/intents/* routes. Follows Aurora's published limits:
 * 100 requests / 10 s and 2,000 / hour per key per endpoint, 429 with Retry-After, token list cached for minutes, status
 * polled every 5-10 s by the UI.
 */

export class IntentsError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly retryAfter?: number,
		readonly code?: string,
	) {
		super(message);
	}
}

/** Development-only canned responses so the UI can be exercised without a key. Never active in production builds. */
export const isMock = () =>
	process.env.INTENTS_MOCK === "1" && process.env.NODE_ENV !== "production";

const apiKey = () => process.env.AURORA_INTENTS_API_KEY?.trim() || "";
export const isConfigured = () => isMock() || apiKey().length > 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call<T>(
	method: "GET" | "POST",
	path: string,
	opts: { query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
	const key = apiKey();
	if (!key)
		throw new IntentsError(
			"Cross-chain funding is not configured.",
			503,
			undefined,
			"not_configured",
		);
	const url = new URL(
		`${AURORA_INTENTS_API_BASE}${path.replace("{key}", encodeURIComponent(key))}`,
	);
	for (const [name, value] of Object.entries(opts.query ?? {}))
		url.searchParams.set(name, value);
	let last: Response | null = null;
	for (let attempt = 0; attempt < 3; attempt++) {
		last = await fetch(url, {
			method,
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
			cache: "no-store",
			signal: AbortSignal.timeout(20_000),
		});
		if (last.status !== 429) break;
		const wait = Number(last.headers.get("retry-after") ?? "1");
		// Only ride out the short (10 s) window; an hourly limit is reported to the user instead of blocking a request.
		if (!Number.isFinite(wait) || wait > 10 || attempt === 2) break;
		await sleep(wait * 1000 + Math.floor(Math.random() * 500));
	}
	const res = last as Response;
	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (!res.ok) {
		const message =
			(json as { message?: string } | null)?.message ??
			(res.status === 429
				? "Too many requests, try again shortly."
				: "The funding service returned an error.");
		throw new IntentsError(
			message,
			res.status,
			Number(res.headers.get("retry-after")) || undefined,
		);
	}
	return json as T;
}

// ------------------------------------------------------------------ token list (cached)

type TokensResponse = { tokens: AuroraToken[] };
let tokenCache: { at: number; tokens: AuroraToken[] } | null = null;
const TOKEN_TTL_MS = 5 * 60_000;

/** Tests only: forget the cached token list. */
export const resetTokenCache = () => {
	tokenCache = null;
};

export async function getTokens(): Promise<AuroraToken[]> {
	if (isMock()) return MOCK_TOKENS;
	if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS)
		return tokenCache.tokens;
	const res = await call<TokensResponse>("GET", "/api/tokens/{key}");
	tokenCache = { at: Date.now(), tokens: res.tokens ?? [] };
	return tokenCache.tokens;
}

// ------------------------------------------------------------------ swap API

export type AuroraQuote = {
	timestamp?: string;
	signature?: string;
	correlationId?: string | null;
	quote: {
		timeEstimate?: number;
		deadline?: string;
		timeWhenInactive?: string;
		depositAddress?: string;
		depositMemo?: string;
		amountIn: string;
		amountInFormatted?: string;
		amountInUsd?: string;
		minAmountIn?: string;
		amountOut: string;
		amountOutFormatted?: string;
		amountOutUsd?: string;
		minAmountOut?: string;
		refundFee?: string;
		withdrawFee?: string;
	};
};

export async function requestQuote(body: unknown): Promise<AuroraQuote> {
	if (isMock())
		return mockQuote(
			body as {
				dry: boolean;
				amount: string;
				originAsset: string;
				destinationAsset: string;
			},
		);
	return call<AuroraQuote>("POST", "/api/quote/{key}", { body });
}

export type AuroraStatus = {
	status: string;
	updatedAt?: string;
	swapDetails?: {
		amountInFormatted?: string;
		amountOutFormatted?: string;
		originChainTxHashes?: { hash: string; explorerUrl?: string }[];
		destinationChainTxHashes?: { hash: string; explorerUrl?: string }[];
		refundedAmountFormatted?: string;
		refundReason?: string;
	};
};

export async function getSwapStatus(
	depositAddress: string,
	depositMemo?: string,
): Promise<AuroraStatus> {
	if (isMock()) return mockStatus(depositAddress);
	return call<AuroraStatus>("GET", "/api/status/{key}", {
		query: { depositAddress, ...(depositMemo ? { depositMemo } : {}) },
	});
}

export async function submitDeposit(body: {
	txHash: string;
	depositAddress: string;
	memo?: string;
}): Promise<AuroraStatus> {
	if (isMock()) return mockStatus(body.depositAddress);
	return call<AuroraStatus>("POST", "/api/deposit/submit/{key}", { body });
}

// ------------------------------------------------------------------ persistent deposit addresses

export type PersistentAddress = {
	depositAddress: string;
	alreadyExists: boolean;
	memo?: string;
	correlationId?: string;
};

export async function createPersistentAddress(body: {
	recipient: string;
	sender: string;
	depositChain: string;
	destinationChain: string;
	destinationAsset: string;
}): Promise<PersistentAddress> {
	if (isMock())
		return {
			depositAddress: mockAddress(body.depositChain),
			alreadyExists: false,
			...(body.depositChain === "stellar" ? { memo: "MOCK-MEMO-1" } : {}),
		};
	return call<PersistentAddress>(
		"POST",
		"/api/persistent-deposit-address/{key}",
		{ body },
	);
}

export type PersistentDeposit = {
	tx_hash: string;
	fromChain: string | null;
	destinationChain: string | null;
	asset_id: string | null;
	decimals: number | null;
	amount: string;
	from: string;
	created_at: string;
	recipient: string;
};

export async function getPersistentDeposits(
	address: string,
	type: "received" | "success" | "failed",
): Promise<PersistentDeposit[]> {
	if (isMock()) return [];
	const res = await call<{ deposits: PersistentDeposit[] }>(
		"GET",
		"/api/persistent-deposit-status/{key}",
		{
			query: { type, address },
		},
	);
	return res.deposits ?? [];
}

// ------------------------------------------------------------------ per-IP limiter (protects our key's quota)

const hits = new Map<string, number[]>();
export function rateLimited(
	ip: string,
	limit = 40,
	windowMs = 60_000,
): boolean {
	const now = Date.now();
	const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
	if (recent.length >= limit) {
		hits.set(ip, recent);
		return true;
	}
	recent.push(now);
	hits.set(ip, recent);
	if (hits.size > 5000) hits.clear();
	return false;
}

// ------------------------------------------------------------------ mock (development only)

const MOCK_TOKENS: AuroraToken[] = [
	{
		assetId: "mock:sol:sol",
		decimals: 9,
		blockchain: "sol",
		symbol: "SOL",
		price: 150,
	},
	{
		assetId: "mock:sol:usdc",
		decimals: 6,
		blockchain: "sol",
		symbol: "USDC",
		price: 1,
	},
	{
		assetId: "mock:base:usdc",
		decimals: 6,
		blockchain: "base",
		symbol: "USDC",
		price: 1,
	},
	{
		assetId: "mock:base:eth",
		decimals: 18,
		blockchain: "base",
		symbol: "ETH",
		price: 3000,
	},
	{
		assetId: "mock:eth:usdt",
		decimals: 6,
		blockchain: "eth",
		symbol: "USDT",
		price: 1,
	},
	{
		assetId: "mock:arb:eth",
		decimals: 18,
		blockchain: "arb",
		symbol: "ETH",
		price: 3000,
	},
	{
		assetId: "mock:btc:btc",
		decimals: 8,
		blockchain: "btc",
		symbol: "BTC",
		price: 60000,
	},
	{
		assetId: "mock:near:near",
		decimals: 24,
		blockchain: "near",
		symbol: "NEAR",
		price: 4,
	},
];
// On globalThis so the quote and status routes (separate module copies in dev) share it. Mock only.
const mockStore = globalThis as unknown as {
	__intentsMockStarted?: Map<string, number>;
};
mockStore.__intentsMockStarted ??= new Map<string, number>();
const mockStarted = mockStore.__intentsMockStarted;
const mockAddress = (chain: string) =>
	chain === "btc"
		? "bc1qmockmockmockmockmockmockmockmockxyz"
		: "0xMOCK000000000000000000000000000000000001";

function mockQuote(body: {
	dry: boolean;
	amount: string;
	originAsset: string;
	destinationAsset: string;
}): AuroraQuote {
	const origin = MOCK_TOKENS.find((t) => t.assetId === body.originAsset);
	const dest = MOCK_TOKENS.find((t) => t.assetId === body.destinationAsset);
	const inUsd =
		(Number(body.amount) / 10 ** (origin?.decimals ?? 6)) *
		(origin?.price ?? 1);
	const outUnits = Math.floor(
		((inUsd * 0.994) / (dest?.price ?? 1)) * 10 ** (dest?.decimals ?? 6),
	);
	const address = mockAddress(origin?.blockchain ?? "base");
	if (!body.dry) mockStarted.set(address, Date.now());
	return {
		correlationId: "mock-correlation",
		quote: {
			timeEstimate: 30,
			...(body.dry
				? {}
				: {
						depositAddress: address,
						deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
						timeWhenInactive: new Date(Date.now() + 15 * 60_000).toISOString(),
					}),
			amountIn: body.amount,
			amountInUsd: inUsd.toFixed(2),
			minAmountIn: body.amount,
			amountOut: String(outUnits),
			amountOutUsd: (inUsd * 0.994).toFixed(2),
			minAmountOut: String(Math.floor(outUnits * 0.99)),
		},
	};
}

function mockStatus(address: string): AuroraStatus {
	const started = mockStarted.get(address) ?? Date.now();
	const s = (Date.now() - started) / 1000;
	const status =
		s < 8
			? "PENDING_DEPOSIT"
			: s < 14
				? "KNOWN_DEPOSIT_TX"
				: s < 22
					? "PROCESSING"
					: "SUCCESS";
	return {
		status,
		updatedAt: new Date().toISOString(),
		swapDetails:
			status === "SUCCESS"
				? { destinationChainTxHashes: [{ hash: "MOCKSOLANASIGNATURE" }] }
				: {},
	};
}
