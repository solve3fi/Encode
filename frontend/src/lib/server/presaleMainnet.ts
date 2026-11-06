import "server-only";
import { Connection } from "@solana/web3.js";

/** Mainnet RPC for presale payments (quotes check the Treasury's USDC account; confirms read the payment). */
export const presaleMainnetConnection = () =>
	new Connection(
		process.env.PRESALE_MAINNET_RPC_URL ||
			process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
			"https://api.mainnet-beta.solana.com",
		"confirmed",
	);

// Live quotes per client address, so nobody can hold the whole cap with a stream of throwaway quotes.
const QUOTE_WINDOW_MS = 10 * 60_000;
const QUOTES_PER_WINDOW = 6;
const recent = new Map<string, number[]>();

export function allowQuote(clientKey: string, now = Date.now()): boolean {
	const kept = (recent.get(clientKey) ?? []).filter(
		(t) => now - t < QUOTE_WINDOW_MS,
	);
	if (kept.length >= QUOTES_PER_WINDOW) {
		recent.set(clientKey, kept);
		return false;
	}
	kept.push(now);
	recent.set(clientKey, kept);
	if (recent.size > 10_000)
		for (const [key, times] of recent)
			if (times.every((t) => now - t >= QUOTE_WINDOW_MS)) recent.delete(key);
	return true;
}

export const clientKeyOf = (headers: Headers) =>
	headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
	headers.get("x-real-ip") ||
	"unknown";
