import "server-only";
import { NextResponse } from "next/server";
import { IntentsError, rateLimited } from "@/lib/server/auroraIntents";

const ADDRESS = /^[A-Za-z0-9._:-]{10,160}$/;
export const looksLikeAddress = (value: unknown): value is string =>
	typeof value === "string" && ADDRESS.test(value);

export function clientIp(request: Request): string {
	return (
		(request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
		"unknown"
	);
}

export const bad = (message: string, status = 400) =>
	NextResponse.json({ error: message }, { status });

/** Limits requests per client so one visitor cannot use up our API key's quota. */
export function limit(request: Request, max = 40): NextResponse | null {
	return rateLimited(clientIp(request), max)
		? bad("Too many requests, try again in a minute.", 429)
		: null;
}

export function fromError(error: unknown): NextResponse {
	if (error instanceof IntentsError) {
		const res = bad(
			error.message,
			error.status === 503 || error.status === 429
				? error.status
				: error.status >= 500
					? 502
					: error.status,
		);
		if (error.retryAfter)
			res.headers.set("retry-after", String(error.retryAfter));
		return res;
	}
	return bad("The funding service is unavailable right now.", 502);
}

export async function readJson(
	request: Request,
): Promise<Record<string, unknown> | null> {
	try {
		const body = await request.json();
		return body && typeof body === "object" && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}
