import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

// Server-side proxy to the Solve3 x402 agent. The browser never sees AGENT_INTERNAL_SECRET: the agent skips
// its x402 payment for requests that carry it, and everyone else still pays. Only the routes below are
// forwarded, so this cannot be used as an open relay.
const ALLOWED: { method: "GET" | "POST"; pattern: RegExp }[] = [
	{ method: "GET", pattern: /^v1\/gauges$/ },
	{ method: "GET", pattern: /^v1\/autovote$/ },
	{ method: "GET", pattern: /^v1\/autovote\/status\/[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
	{ method: "GET", pattern: /^v1\/locks\/[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
	{ method: "GET", pattern: /^v1\/claimable\/[1-9A-HJ-NP-Za-km-z]{32,44}$/ },
	{
		method: "GET",
		pattern: /^v1\/vote-plan\/[1-9A-HJ-NP-Za-km-z]{32,44}\/\d{1,10}$/,
	},
	{
		method: "POST",
		pattern: /^v1\/tx\/(claim-all|vote|lock|increase-lock|autovote\/(enable|disable))$/,
	},
];
const MAX_BODY = 8 * 1024;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();

function limited(ip: string): boolean {
	const now = Date.now();
	const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	recent.push(now);
	hits.set(ip, recent);
	if (hits.size > 5000) hits.clear();
	return recent.length > MAX_PER_WINDOW;
}

async function handle(
	request: NextRequest,
	context: { params: Promise<{ path: string[] }> },
) {
	const base = process.env.AGENT_API_URL;
	const secret = process.env.AGENT_INTERNAL_SECRET;
	if (process.env.NEXT_PUBLIC_AGENT_ENABLED !== "1" || !base || !secret)
		return NextResponse.json({ error: "Not found" }, { status: 404 });

	const path = (await context.params).path.join("/");
	const method = request.method as "GET" | "POST";
	if (!ALLOWED.some((r) => r.method === method && r.pattern.test(path)))
		return NextResponse.json({ error: "Not found" }, { status: 404 });

	const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
	if (limited(ip))
		return NextResponse.json({ error: "Too many requests" }, { status: 429 });

	let body: string | undefined;
	if (method === "POST") {
		body = await request.text();
		if (body.length > MAX_BODY)
			return NextResponse.json({ error: "Body too large" }, { status: 413 });
	}

	try {
		const upstream = await fetch(`${base.replace(/\/$/, "")}/${path}`, {
			method,
			headers: {
				"x-solve3-internal": secret,
				...(body ? { "content-type": "application/json" } : {}),
			},
			body,
			signal: AbortSignal.timeout(60_000),
			cache: "no-store",
		});
		const text = await upstream.text();
		return new NextResponse(text, {
			status: upstream.status,
			headers: { "content-type": "application/json", "cache-control": "no-store" },
		});
	} catch {
		return NextResponse.json({ error: "Agent unavailable" }, { status: 502 });
	}
}

export const GET = handle;
export const POST = handle;
