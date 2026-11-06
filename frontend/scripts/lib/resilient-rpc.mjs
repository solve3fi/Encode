// Keeper RPC connection that survives a rate-limited or flaky endpoint.
//
// The public devnet RPC answers 429 under load. web3.js retries those itself but gives up quickly, and
// a keeper that fails mid-settlement just waits for its next timer run. This wraps fetch with bounded
// exponential backoff (honouring Retry-After) and rotates through optional fallback endpoints:
//   SOLVE3_RPC_URL            primary (a private RPC is recommended)
//   SOLVE3_RPC_FALLBACK_URLS  comma-separated extra endpoints, tried in order after the primary
// Only transport failures, 408, 429 and 5xx are retried. A JSON-RPC error inside an HTTP 200 is returned
// untouched, and replaying a sendTransaction of the same signed bytes is safe.
import { Connection } from "@solana/web3.js";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const parseRpcUrls = (primary, fallbacks) => [
	...new Set(
		[primary, ...String(fallbacks ?? "").split(",")]
			.map((value) => value?.trim())
			.filter(Boolean),
	),
];

export const retryDelayMs = (attempt, retryAfter, baseMs, maxMs, random = Math.random) => {
	const seconds = Number(retryAfter);
	const hinted = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
	const backoff = baseMs * 2 ** attempt * (0.75 + random() * 0.5);
	return Math.min(maxMs, Math.max(hinted, backoff));
};

export function createResilientFetch(urls, options = {}) {
	if (!urls.length) throw new Error("At least one RPC URL is required.");
	const {
		attempts = 7,
		baseMs = 400,
		maxDelayMs = 8000,
		fetchImpl = fetch,
		onRetry = () => {},
		random = Math.random,
		wait = sleep,
	} = options;
	let preferred = 0;
	return async (_info, init) => {
		let lastError;
		for (let attempt = 0; attempt < attempts; attempt++) {
			const index = (preferred + attempt) % urls.length;
			let retryAfter;
			try {
				const response = await fetchImpl(urls[index], init);
				if (!RETRYABLE_STATUS.has(response.status)) {
					preferred = index;
					return response;
				}
				retryAfter = response.headers.get("retry-after");
				lastError = new Error(`RPC ${new URL(urls[index]).host} answered HTTP ${response.status}`);
				await response.arrayBuffer().catch(() => {});
			} catch (error) {
				lastError = error;
			}
			if (attempt === attempts - 1) break;
			// A single endpoint backs off; with fallbacks the next one is tried after a short pause.
			const delay = retryDelayMs(Math.floor(attempt / urls.length), retryAfter, baseMs, maxDelayMs, random);
			onRetry({ attempt: attempt + 1, delayMs: delay, error: String(lastError?.message ?? lastError) });
			await wait(delay);
		}
		throw lastError;
	};
}

export function createResilientConnection(primary, commitment = "confirmed", options = {}) {
	const urls = parseRpcUrls(primary, options.fallbacks ?? process.env.SOLVE3_RPC_FALLBACK_URLS);
	return new Connection(urls[0], {
		commitment,
		disableRetryOnRateLimit: true,
		fetch: createResilientFetch(urls, options),
	});
}
