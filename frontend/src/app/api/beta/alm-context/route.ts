// Live market context for the ALM beta page: Fear & Greed and the Hyperliquid SOL perp (funding, open interest).
// Read-only, public data, cached for 5 minutes. Context only: the ALM research found these inputs add no measurable edge,
// so nothing on the page is driven by them. Any upstream failure is reported per source and never breaks the page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = {
	fearGreed: { available: boolean; value?: number; classification?: string; previous?: number; fetchedAt: number; error?: string };
	sol: { available: boolean; markPrice?: number; fundingPerHour?: number; fundingAnnualizedPct?: number; openInterestUsd?: number; fetchedAt: number; error?: string };
};

const TTL_MS = 5 * 60_000;
let cache: { at: number; value: Ctx } | null = null;

const get = async (url: string, init?: RequestInit) => {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000), cache: "no-store" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
};

async function load(): Promise<Ctx> {
	const now = Date.now();
	const [fg, sol] = await Promise.allSettled([
		get("https://api.alternative.me/fng/?limit=2"),
		get("https://api.hyperliquid.xyz/info", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ type: "metaAndAssetCtxs" }),
		}),
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

	return { fearGreed, sol: solOut };
}

export async function GET() {
	if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), value: await load() };
	return Response.json(cache.value, { headers: { "cache-control": "public, max-age=60" } });
}
