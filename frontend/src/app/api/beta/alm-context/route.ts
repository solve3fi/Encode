// Live market context for the ALM beta page: Fear & Greed, the Hyperliquid SOL perp (funding, open interest) and
// SOL realised volatility + drift over the last 72 hours from Coinbase hourly candles (same formula as the ALM engine).
// Read-only, public data, cached for 5 minutes. Context only: the ALM research found these inputs add no measurable edge,
// so nothing on the page is driven by them. Any upstream failure is reported per source and never breaks the page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = {
	fearGreed: { available: boolean; value?: number; classification?: string; previous?: number; fetchedAt: number; error?: string };
	sol: { available: boolean; markPrice?: number; fundingPerHour?: number; fundingAnnualizedPct?: number; openInterestUsd?: number; fetchedAt: number; error?: string };
	market: { available: boolean; lookbackHours: number; sigmaAnnualized?: number; driftPctPerHour?: number; lastClose?: number; bars?: number; fetchedAt: number; error?: string };
};

const LOOKBACK_HOURS = 72;

// ALM engine method (src/solpool-economics.ts realizedHourlyVol): sample std-dev of hourly log returns, annualised by
// sqrt(24*365); drift = ln(last/first) / bars * 100, in % per hour. Candles: [time, low, high, open, close, volume].
function marketFromCandles(rows: unknown, now: number): Ctx["market"] {
	const out: Ctx["market"] = { available: false, lookbackHours: LOOKBACK_HOURS, fetchedAt: now, error: "unavailable" };
	if (!Array.isArray(rows)) return { ...out, error: "unexpected response" };
	const closes = rows
		.filter((r): r is number[] => Array.isArray(r) && Number.isFinite(Number(r[0])) && Number(r[4]) > 0)
		.map((r) => ({ t: Number(r[0]), c: Number(r[4]) }))
		.sort((a, b) => a.t - b.t)
		.slice(-(LOOKBACK_HOURS + 1));
	if (closes.length < 24) return { ...out, error: "not enough candles" };
	const rets = closes.slice(1).map((x, i) => Math.log(x.c / closes[i].c));
	const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
	const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1));
	const drift = (Math.log(closes[closes.length - 1].c / closes[0].c) / rets.length) * 100;
	if (!Number.isFinite(sd) || !Number.isFinite(drift)) return { ...out, error: "invalid candles" };
	return { available: true, lookbackHours: LOOKBACK_HOURS, sigmaAnnualized: sd * Math.sqrt(24 * 365), driftPctPerHour: drift, lastClose: closes[closes.length - 1].c, bars: closes.length, fetchedAt: now };
}

const TTL_MS = 5 * 60_000;
let cache: { at: number; value: Ctx } | null = null;

const get = async (url: string, init?: RequestInit) => {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), cache: "no-store" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
};

async function load(): Promise<Ctx> {
	const now = Date.now();
	const [fg, sol, candles] = await Promise.allSettled([
		get("https://api.alternative.me/fng/?limit=2"),
		get("https://api.hyperliquid.xyz/info", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "metaAndAssetCtxs" }),
		}),
		get("https://api.exchange.coinbase.com/products/SOL-USD/candles?granularity=3600", { headers: { "user-agent": "solve3-alm-beta" } }),
	]);

	const fearGreed: Ctx["fearGreed"] = { available: false, fetchedAt: now, error: "unavailable" };
	if (fg.status === "fulfilled") {
		const d = fg.value?.data;
		const v = Number(d?.[0]?.value);
		if (Number.isFinite(v)) {
			Object.assign(fearGreed, {
				available: true,
				value: v,
				classification: String(d[0].value_classification ?? ""),
				previous: Number.isFinite(Number(d?.[1]?.value)) ? Number(d[1].value) : undefined,
				error: undefined,
			});
		}
	} else fearGreed.error = String(fg.reason?.message ?? fg.reason).slice(0, 80);

	const solOut: Ctx["sol"] = { available: false, fetchedAt: now, error: "unavailable" };
	if (sol.status === "fulfilled") {
		try {
			const [meta, ctxs] = sol.value as [{ universe: { name: string }[] }, Record<string, string>[]];
			const i = meta.universe.findIndex((u) => u.name === "SOL");
			const c = ctxs[i];
			const mark = Number(c.markPx);
			const funding = Number(c.funding);
			if (i >= 0 && Number.isFinite(mark) && Number.isFinite(funding)) {
				Object.assign(solOut, {
					available: true,
					markPrice: mark,
					fundingPerHour: funding,
					fundingAnnualizedPct: funding * 24 * 365 * 100,
					openInterestUsd: Number.isFinite(Number(c.openInterest)) ? Number(c.openInterest) * mark : undefined,
					error: undefined,
				});
			}
		} catch {
			solOut.error = "unexpected response";
		}
	} else solOut.error = String(sol.reason?.message ?? sol.reason).slice(0, 80);

	const market =
		candles.status === "fulfilled"
			? marketFromCandles(candles.value, now)
			: { available: false, lookbackHours: LOOKBACK_HOURS, fetchedAt: now, error: String(candles.reason?.message ?? candles.reason).slice(0, 80) };

	return { fearGreed, sol: solOut, market };
}

export async function GET() {
	if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), value: await load() };
	return Response.json(cache.value, { headers: { "cache-control": "public, max-age=60" } });
}
