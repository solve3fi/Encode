import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// "server-only" throws outside the Next server bundle; the routes under test are server code.
mock.module("server-only", () => ({}));

import { PublicKey } from "@solana/web3.js";
import { fromBaseUnits, toBaseUnits } from "./amount";
import {
	type AuroraToken,
	buildQuoteRequest,
	describeStatus,
	destinationTokens,
	isSolanaAddress,
	secondsUntil,
	sourceTokens,
} from "./aurora";
import { resolveChain } from "./chains";

const WALLET = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const TOKENS: AuroraToken[] = [
	{
		assetId: "sol-sol",
		decimals: 9,
		blockchain: "sol",
		symbol: "SOL",
		price: 150,
	},
	{
		assetId: "sol-usdc",
		decimals: 6,
		blockchain: "sol",
		symbol: "USDC",
		price: 1,
	},
	{ assetId: "sol-bonk", decimals: 5, blockchain: "sol", symbol: "BONK" },
	{
		assetId: "base-usdc",
		decimals: 6,
		blockchain: "base",
		symbol: "USDC",
		price: 1,
	},
	{
		assetId: "base-eth",
		decimals: 18,
		blockchain: "base",
		symbol: "ETH",
		price: 3000,
	},
	{
		assetId: "btc-btc",
		decimals: 8,
		blockchain: "btc",
		symbol: "BTC",
		price: 60000,
	},
];
const quoteInput = (over: Record<string, unknown> = {}) => ({
	originAsset: "base-usdc",
	destinationAsset: "sol-sol",
	amount: "25000000",
	recipient: WALLET,
	refundTo: "0xabc0000000000000000000000000000000000001",
	dry: true,
	...over,
});

describe("amounts", () => {
	test("toBaseUnits is exact and strict", () => {
		expect(toBaseUnits("1.5", 6)).toBe("1500000");
		expect(toBaseUnits("0.000001", 6)).toBe("1");
		expect(toBaseUnits("100", 6)).toBe("100000000");
		expect(toBaseUnits("0.1", 18)).toBe("100000000000000000");
		expect(toBaseUnits("0.0000001", 6)).toBeNull(); // too many places, never rounded
		expect(toBaseUnits("0", 6)).toBeNull();
		expect(toBaseUnits("0.0", 6)).toBeNull();
		expect(toBaseUnits("-1", 6)).toBeNull();
		expect(toBaseUnits("1e6", 6)).toBeNull();
		expect(toBaseUnits("", 6)).toBeNull();
		expect(toBaseUnits("1,5", 6)).toBeNull();
	});
	test("fromBaseUnits", () => {
		expect(fromBaseUnits("1500000", 6)).toBe("1.5");
		expect(fromBaseUnits("1", 6)).toBe("0.000001");
		expect(fromBaseUnits("100000000", 6)).toBe("100");
		expect(fromBaseUnits("123456789", 9, 4)).toBe("0.1234");
		expect(fromBaseUnits("abc", 6)).toBe("0");
	});
});

describe("chains", () => {
	test("aliases", () => {
		expect(resolveChain("Ethereum")?.slug).toBe("eth");
		expect(resolveChain("arbitrum")?.slug).toBe("arb");
		expect(resolveChain("bitcoin")?.slug).toBe("btc");
		expect(resolveChain("evm")?.slug).toBe("base");
		expect(resolveChain("dogecoin")).toBeNull();
	});
});

describe("quote request", () => {
	test("builds the exact body Aurora expects", () => {
		const r = buildQuoteRequest(quoteInput(), TOKENS);
		expect(r.ok && r.body).toEqual({
			dry: true,
			swapType: "EXACT_INPUT",
			depositType: "ORIGIN_CHAIN",
			amount: "25000000",
			originAsset: "base-usdc",
			destinationAsset: "sol-sol",
			slippageTolerance: 100,
			refundTo: "0xabc0000000000000000000000000000000000001",
			refundType: "ORIGIN_CHAIN",
			recipient: WALLET,
			recipientType: "DESTINATION_CHAIN",
		});
	});
	test("refuses anything outside the offered flow", () => {
		const err = (over: Record<string, unknown>) => {
			const r = buildQuoteRequest(quoteInput(over), TOKENS);
			return r.ok ? null : r.error;
		};
		expect(err({ originAsset: "nope" })).toContain("Unknown source");
		expect(err({ destinationAsset: "base-eth" })).toContain(
			"SOL or USDC on Solana",
		);
		expect(err({ destinationAsset: "sol-bonk" })).toContain(
			"SOL or USDC on Solana",
		);
		expect(
			err({ originAsset: "sol-sol", destinationAsset: "sol-sol" }),
		).not.toBeNull();
		expect(err({ amount: "0" })).toContain("above zero");
		expect(err({ amount: "1.5" })).toContain("above zero");
		expect(err({ amount: "-5" })).toContain("above zero");
		expect(err({ recipient: "notasolanaaddress" })).toContain("Solana wallet");
		expect(err({ refundTo: "  " })).toContain("refund");
		expect(err({ slippageBps: 5000 })).toContain("Slippage");
		expect(err({ slippageBps: 0 })).toContain("Slippage");
	});
	test("slippage in range is passed through", () => {
		const r = buildQuoteRequest(
			quoteInput({ slippageBps: 50, dry: false }),
			TOKENS,
		);
		expect(r.ok && r.body.slippageTolerance).toBe(50);
		expect(r.ok && r.body.dry).toBe(false);
	});
	test("solana address check is strict", () => {
		expect(isSolanaAddress(WALLET)).toBe(true);
		expect(isSolanaAddress("0xabc")).toBe(false);
		expect(isSolanaAddress("")).toBe(false);
	});
	test("token lists", () => {
		expect(sourceTokens(TOKENS, "base").map((t) => t.symbol)).toEqual([
			"USDC",
			"ETH",
		]);
		const odd = (symbol: string): AuroraToken => ({
			assetId: `base-${symbol}`,
			decimals: 18,
			blockchain: "base",
			symbol,
		});
		expect(
			sourceTokens(
				[odd("ZRX"), odd("AAVE"), odd("USDT"), odd("ETH"), odd("USDC")],
				"base",
			).map((t) => t.symbol),
		).toEqual(["USDC", "USDT", "ETH", "AAVE", "ZRX"]);
		expect(sourceTokens(TOKENS, "sol")).toEqual([]);
		expect(destinationTokens(TOKENS).map((t) => t.symbol)).toEqual([
			"SOL",
			"USDC",
		]);
	});
});

describe("status wording", () => {
	test("every status has a view and only the last ones are final", () => {
		const finals = ["SUCCESS", "REFUNDED", "FAILED"];
		for (const s of [
			"PENDING_DEPOSIT",
			"KNOWN_DEPOSIT_TX",
			"INCOMPLETE_DEPOSIT",
			"PROCESSING",
			"SUCCESS",
			"REFUNDED",
			"FAILED",
		]) {
			const v = describeStatus(s);
			expect(v.title.length).toBeGreaterThan(3);
			expect(v.final).toBe(finals.includes(s));
		}
		expect(describeStatus("SUCCESS").phase).toBe("done");
		expect(describeStatus("REFUNDED", "price moved").detail).toContain(
			"price moved",
		);
		expect(describeStatus("WHATEVER").final).toBe(false);
	});
	test("secondsUntil", () => {
		expect(
			secondsUntil("2026-01-01T00:10:00Z", Date.parse("2026-01-01T00:00:00Z")),
		).toBe(600);
		expect(
			secondsUntil("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:05:00Z")),
		).toBe(0);
		expect(secondsUntil(undefined)).toBeNull();
		expect(secondsUntil("junk")).toBeNull();
	});
});

// ------------------------------------------------------------------------------------------- API routes with a faked Aurora

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];
let replies: ((url: URL) => Response)[] = [];
const realFetch = globalThis.fetch;
const json = (
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

beforeEach(async () => {
	(await import("@/lib/server/auroraIntents")).resetTokenCache();
	process.env.AURORA_INTENTS_API_KEY = "testkey";
	process.env.INTENTS_MOCK = "";
	calls = [];
	replies = [];
	// biome-ignore lint/suspicious/noExplicitAny: test double
	globalThis.fetch = (async (input: any, init?: any) => {
		const url = new URL(String(input));
		calls.push({
			url: url.pathname + url.search,
			method: init?.method ?? "GET",
			body: init?.body ? JSON.parse(init.body) : undefined,
		});
		const next = replies.shift();
		return next ? next(url) : json({ message: "unexpected" }, 500);
	}) as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const req = (path: string, init?: RequestInit) =>
	new Request(`http://localhost${path}`, init);
const post = (path: string, body: unknown) =>
	req(path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-forwarded-for": `9.9.9.${Math.floor(Math.random() * 250)}`,
		},
		body: JSON.stringify(body),
	});
const tokensReply = () => json({ tokens: TOKENS });

describe("routes", () => {
	test("tokens: not configured without a key", async () => {
		process.env.AURORA_INTENTS_API_KEY = "";
		const { GET } = await import("@/app/api/intents/tokens/route");
		const res = await GET(req("/api/intents/tokens"));
		expect(await res.json()).toEqual({
			configured: false,
			mock: false,
			tokens: [],
		});
		expect(calls.length).toBe(0);
	});

	test("quote: validates, then sends the exact body with the key in the path", async () => {
		const { POST } = await import("@/app/api/intents/quote/route");
		replies = [
			tokensReply,
			() =>
				json({
					quote: {
						amountIn: "25000000",
						amountOut: "160000000",
						depositAddress: "0xDEP00000000000000000000000000000000000001",
						deadline: "2026-01-01T00:10:00Z",
					},
				}),
		];
		const res = await POST(
			post("/api/intents/quote", quoteInput({ dry: false })),
		);
		expect(res.status).toBe(200);
		const out = await res.json();
		expect(out.quote.depositAddress).toContain("0xDEP");
		const quoteCall = calls.find((c) => c.url.startsWith("/api/quote/testkey"));
		expect(quoteCall?.method).toBe("POST");
		expect(quoteCall?.body).toMatchObject({
			dry: false,
			swapType: "EXACT_INPUT",
			refundType: "ORIGIN_CHAIN",
			recipientType: "DESTINATION_CHAIN",
			recipient: WALLET,
		});
	});

	test("quote: bad requests never reach Aurora", async () => {
		const { POST } = await import("@/app/api/intents/quote/route");
		replies = [tokensReply];
		const res = await POST(
			post("/api/intents/quote", quoteInput({ destinationAsset: "base-eth" })),
		);
		expect(res.status).toBe(400);
		expect(calls.some((c) => c.url.startsWith("/api/quote"))).toBe(false);
		const none = await POST(
			req("/api/intents/quote", { method: "POST", body: "not json" }),
		);
		expect(none.status).toBe(400);
	});

	test("quote: rides out a short 429 and then succeeds", async () => {
		const { POST } = await import("@/app/api/intents/quote/route");
		replies = [
			tokensReply,
			() => json({ message: "slow down" }, 429, { "retry-after": "0" }),
			() => json({ quote: { amountIn: "1", amountOut: "1" } }),
		];
		const res = await POST(post("/api/intents/quote", quoteInput()));
		expect(res.status).toBe(200);
		expect(calls.filter((c) => c.url.startsWith("/api/quote")).length).toBe(2);
	});

	test("quote: an hourly limit is reported, not waited out", async () => {
		const { POST } = await import("@/app/api/intents/quote/route");
		replies = [
			tokensReply,
			() => json({ message: "limit" }, 429, { "retry-after": "1800" }),
		];
		const res = await POST(post("/api/intents/quote", quoteInput()));
		expect(res.status).toBe(429);
		expect(res.headers.get("retry-after")).toBe("1800");
	});

	test("status: maps Aurora's status to wording and trims details", async () => {
		const { GET } = await import("@/app/api/intents/status/route");
		replies = [
			() =>
				json({
					status: "PROCESSING",
					updatedAt: "t",
					swapDetails: {
						amountOutFormatted: "1.2",
						destinationChainTxHashes: [{ hash: "abc" }],
					},
				}),
		];
		const res = await GET(
			req(
				"/api/intents/status?depositAddress=0xDEP00000000000000000000000000000000000001",
			),
		);
		const out = await res.json();
		expect(out.status).toBe("PROCESSING");
		expect(out.view.step).toBe(3);
		expect(out.details.amountOut).toBe("1.2");
		expect(calls[0].url).toContain("/api/status/testkey?depositAddress=0xDEP");
		expect((await GET(req("/api/intents/status"))).status).toBe(400);
		expect(
			(await GET(req("/api/intents/status?depositAddress=<script>"))).status,
		).toBe(400);
	});

	test("deposit-address: persistent address for the connected wallet only", async () => {
		const { POST } = await import("@/app/api/intents/deposit-address/route");
		replies = [
			() =>
				json({
					depositAddress: "0xPERSIST00000000000000000000000000000001",
					alreadyExists: true,
				}),
		];
		const res = await POST(
			post("/api/intents/deposit-address", {
				depositChain: "ethereum",
				destinationAsset: "usdc",
				recipient: WALLET,
			}),
		);
		const out = await res.json();
		expect(out.depositAddress).toContain("0xPERSIST");
		expect(out.alreadyExisted).toBe(true);
		expect(calls[0].body).toEqual({
			recipient: WALLET,
			sender: WALLET,
			depositChain: "eth",
			destinationChain: "sol",
			destinationAsset: "USDC",
		});
		expect(
			(
				await POST(
					post("/api/intents/deposit-address", {
						depositChain: "sol",
						destinationAsset: "SOL",
						recipient: WALLET,
					}),
				)
			).status,
		).toBe(400);
		expect(
			(
				await POST(
					post("/api/intents/deposit-address", {
						depositChain: "base",
						destinationAsset: "BONK",
						recipient: WALLET,
					}),
				)
			).status,
		).toBe(400);
		expect(
			(
				await POST(
					post("/api/intents/deposit-address", {
						depositChain: "base",
						destinationAsset: "SOL",
						recipient: "bad",
					}),
				)
			).status,
		).toBe(400);
	});

	test("submit: validates the hash", async () => {
		const { POST } = await import("@/app/api/intents/submit/route");
		expect(
			(
				await POST(
					post("/api/intents/submit", {
						txHash: "x",
						depositAddress: "0xDEP00000000000000000000000000000000000001",
					}),
				)
			).status,
		).toBe(400);
		replies = [() => json({ status: "KNOWN_DEPOSIT_TX" })];
		const ok = await POST(
			post("/api/intents/submit", {
				txHash: "0xabcdef0123456789abcdef",
				depositAddress: "0xDEP00000000000000000000000000000000000001",
			}),
		);
		expect((await ok.json()).status).toBe("KNOWN_DEPOSIT_TX");
		expect(calls[0].url).toBe("/api/deposit/submit/testkey");
	});
});
