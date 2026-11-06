import type { RpcFetch } from "./mainnetRpcFetch";

const METHODS = new Set([
	"getAccountInfo", "getMultipleAccounts", "getProgramAccounts", "getBalance",
	"getTokenAccountsByOwner", "getTokenAccountBalance", "getTokenSupply",
	"getLatestBlockhash", "getBlockHeight", "getSlot", "getBlock", "getBlockTime",
	"getEpochInfo", "getEpochSchedule", "getSignatureStatuses", "getTransaction",
	"getSignaturesForAddress", "getMinimumBalanceForRentExemption", "getFeeForMessage",
	"getRecentPrioritizationFees", "getVersion", "getGenesisHash", "isBlockhashValid",
	"simulateTransaction", "sendTransaction",
]);
const MAX_BODY = 64 * 1024;

const MAINNET_PROGRAMS = ["HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK"];

export function validRpcPayload(body: unknown, programIds: readonly string[] = MAINNET_PROGRAMS): boolean {
	const calls = Array.isArray(body) ? body : [body];
	return calls.length > 0 && calls.length <= 10 && calls.every((call) =>
		call && typeof call === "object" && call.jsonrpc === "2.0" &&
		(typeof call.id === "string" || (typeof call.id === "number" && Number.isFinite(call.id))) &&
		METHODS.has(call.method) && (call.params === undefined || Array.isArray(call.params)) &&
		(call.method !== "getProgramAccounts" || (
			programIds.includes(call.params?.[0]) &&
			Array.isArray(call.params?.[1]?.filters) && call.params[1].filters.length > 0 && call.params[1].filters.length <= 4
		)),
	);
}

export function createRpcHandler(
	rpcFetch: RpcFetch, endpoint: string,
	options: {
		publicOrigin?: string; programIds: readonly string[]; clientCallsPerMinute?: number;
		/** Longer shared cache for the dev site: reads live this long, concurrent duplicates are merged, and entries the /v2 page uses stay warm. */
		sharedCacheMs?: number;
	},
) {
	const { publicOrigin, programIds } = options;
	const clientLimit = options.clientCallsPerMinute ?? 180;
	const clients = new Map<string, { count: number; until: number }>();
	const cache = new Map<string, { value: Record<string, unknown>; until: number }>();
	const sharedMs = options.sharedCacheMs ?? 0;
	const cacheable = new Set(["getAccountInfo", "getMultipleAccounts", "getProgramAccounts", "getTokenSupply", "getMinimumBalanceForRentExemption", "getLatestBlockhash",
		...(sharedMs ? ["getBalance", "getTokenAccountBalance", "getTokenAccountsByOwner"] : [])]);
	// Shared-cache state. `generation` bumps whenever a transaction is sent or confirmed, so nothing read before that
	// moment is stored or served afterwards: a wallet never sees its own pre-transaction state from the cache.
	let generation = 0;
	const inflight = new Map<string, Promise<Record<string, unknown>>>();
	const hot = new Map<string, { method: string; params: unknown[] | undefined; seen: number; fetched: number }>();
	const WARM_METHODS = new Set(["getAccountInfo", "getMultipleAccounts", "getProgramAccounts", "getTokenSupply"]);
	let warmTimer: ReturnType<typeof setInterval> | null = null;
	const flush = () => { generation++; cache.clear(); inflight.clear(); };
	const ttlFor = (method: string) => (method === "getLatestBlockhash" ? 1000 : sharedMs || 5000);
	let budget = { used: 0, until: 0 };
	const privateValues = [endpoint, ...new URL(endpoint).searchParams.values()].filter((value) => value.length > 8);
	// Refresh-ahead: while the /v2 page has been used recently, re-read its shared accounts one at a time (so the paced
	// upstream is never flooded) shortly before they expire, so the next visitor finds them warm.
	function startWarmer() {
		warmTimer = setInterval(() => {
			const now = Date.now();
			for (const [k, h] of hot) if (now - h.seen > 5 * 60_000) { hot.delete(k); }
			if (hot.size === 0 && warmTimer) { clearInterval(warmTimer); warmTimer = null; return; }
			if (budget.used > 700) return;
			let pick: string | null = null;
			let oldest = Infinity;
			for (const [k, h] of hot) {
				if (inflight.has(k) || now - h.fetched < sharedMs * 0.66) continue;
				if (h.fetched < oldest) { oldest = h.fetched; pick = k; }
			}
			if (!pick) return;
			const h = hot.get(pick)!;
			h.fetched = now;
			const gen = generation;
			budget.used += h.method === "getProgramAccounts" ? 20 : 1;
			const task = (async () => {
				const upstream = await rpcFetch(endpoint, {
					method: "POST", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: h.method, params: h.params }),
				});
				if (!upstream.ok) throw new Error("RPC unavailable");
				let serialized = JSON.stringify(await upstream.json());
				for (const value of privateValues) serialized = serialized.split(value).join("[redacted]");
				const result = JSON.parse(serialized);
				if (result && !result.error && serialized.length <= 128 * 1024 && gen === generation)
					cache.set(pick!, { value: result, until: Date.now() + sharedMs });
				return result as Record<string, unknown>;
			})();
			inflight.set(pick, task);
			const done = () => { if (inflight.get(pick!) === task) inflight.delete(pick!); };
			void task.then(done, done);
		}, 800);
		(warmTimer as { unref?: () => void }).unref?.();
	}
	return async (request: Request): Promise<Response> => {
		const origin = request.headers.get("origin");
		if (origin && origin !== (publicOrigin || new URL(request.url).origin)) return new Response(null, { status: 403 });
		const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
		const now = Date.now();
		for (const [key, entry] of clients) if (entry.until <= now) clients.delete(key);
		const entry = clients.get(client) || { count: 0, until: now + 60_000 };
		if (entry.count >= clientLimit || (!clients.has(client) && clients.size >= 5000))
			return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
		entry.count += 1; clients.set(client, entry);
		const reader = request.body?.getReader();
		if (!reader) return new Response(null, { status: 400 });
		let size = 0;
		const chunks: Uint8Array[] = [];
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BODY) { await reader.cancel(); return new Response(null, { status: 413 }); }
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		let body: unknown;
		try { body = JSON.parse(new TextDecoder().decode(bytes)); }
		catch { return new Response(null, { status: 400 }); }
		if (!validRpcPayload(body, programIds)) return new Response(null, { status: 400 });
		const calls = (Array.isArray(body) ? body : [body]) as { method: string; params?: unknown[]; id: string | number }[];
		entry.count += calls.length - 1;
		if (entry.count > clientLimit) return new Response(null, { status: 429 });
		// Batch and object replies have different shapes, even for one call.
		const single = !Array.isArray(body) ? calls[0] : null;
		const key = single && cacheable.has(single.method) ? JSON.stringify([single.method, single.params]) : null;
		const hit = key ? cache.get(key) : undefined;
		if (hit && hit.until > Date.now()) return Response.json({ ...hit.value, id: single!.id }, { headers: { "Cache-Control": "no-store", "x-s3-cache": "HIT" } });
		if (sharedMs && calls.some((call) => call.method === "sendTransaction")) {
			// Flush now and again after the transaction has likely landed, so reads that raced it are dropped too.
			flush();
			for (const delay of [4_000, 10_000]) (setTimeout(flush, delay) as { unref?: () => void }).unref?.();
		}
		if (sharedMs && key && single && WARM_METHODS.has(single.method) && /\/(?:v2|arena)(\/|$|\?)/.test(request.headers.get("referer") ?? "")) {
			const known = hot.get(key);
			hot.set(key, { method: single.method, params: single.params, seen: Date.now(), fetched: known?.fetched ?? 0 });
		}
		// Identical reads already on their way upstream share that one call.
		const shared = sharedMs && key ? inflight.get(key) : undefined;
		if (shared) {
			try { return Response.json({ ...(await shared), id: single!.id }, { headers: { "Cache-Control": "no-store", "x-s3-cache": "SHARED" } }); }
			catch { /* fall through to a normal upstream call */ }
		}
		if (budget.until <= Date.now()) budget = { used: 0, until: Date.now() + 60_000 };
		const cost = calls.reduce((sum, call) => sum + (call.method === "getProgramAccounts" || call.method === "getBlock" ? 20 : call.method === "simulateTransaction" ? 10 : 1), 0);
		// Bound provider spend even when an attacker rotates client addresses.
		if (budget.used + cost > 1200) return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
		budget.used += cost;
		const startedGeneration = generation;
		const run = async (): Promise<Record<string, unknown>> => {
			const upstream = await rpcFetch(endpoint, {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body), signal: request.signal,
			});
			if (!upstream.ok) throw new Error("RPC unavailable");
			let serialized = JSON.stringify(await upstream.json());
			for (const value of privateValues) serialized = serialized.split(value).join("[redacted]");
			const result = JSON.parse(serialized);
			if (sharedMs && calls.some((call) => call.method === "getSignatureStatuses") && serialized.includes("confirmationStatus")) flush();
			if (key && result && !result.error && serialized.length <= 128 * 1024 && generation === startedGeneration) {
				if (cache.size >= (sharedMs ? 160 : 64)) cache.delete(cache.keys().next().value!);
				cache.set(key, { value: result, until: Date.now() + ttlFor(single!.method) });
				const known = hot.get(key);
				if (known) known.fetched = Date.now();
			}
			return result;
		};
		try {
			const pending = run();
			if (sharedMs && key) {
				inflight.set(key, pending);
				void pending.then(() => { if (inflight.get(key) === pending) inflight.delete(key); }, () => { if (inflight.get(key) === pending) inflight.delete(key); });
			}
			const result = await pending;
			if (sharedMs && key && !warmTimer && hot.size > 0) startWarmer();
			return Response.json(result, { headers: { "Cache-Control": "no-store", "x-s3-cache": "MISS" } });
		} catch (error) {
			if (error instanceof Error && error.name === "RpcQueueFullError")
				return new Response(null, { status: 429, headers: { "Retry-After": "1" } });
			return Response.json({ error: "RPC is temporarily unavailable. Please retry." }, { status: 503 });
		}
	};
}

/** Mainnet keeps its own handler state and restricted program list. */
export function createMainnetRpcHandler(rpcFetch: RpcFetch, endpoint: string, publicOrigin?: string) {
	return createRpcHandler(rpcFetch, endpoint, { publicOrigin, programIds: MAINNET_PROGRAMS });
}
