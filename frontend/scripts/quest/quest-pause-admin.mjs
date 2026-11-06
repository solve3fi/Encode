// Admin endpoint for the Quest pause switches (migration 022). It is NOT part of the public gateway: only the
// website's own server calls it, with a long shared bearer token, after the website has verified that a
// signed request came from an admin wallet. It uses its own database login, which can read the switches and
// move one through quest.set_pause and nothing else. Without a token (or a pool) the route does not exist.
import { createHash, timingSafeEqual } from "node:crypto";

export const PAUSE_KEYS = Object.freeze([
	"weekly-xp",
	"voting-xp",
	"onboarding-xp",
	"referrals",
	"pass-mint",
	"community-xp",
]);
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_BODY = 2048;
const headers = {
	"Content-Type": "application/json",
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
const sha = (value) => createHash("sha256").update(value).digest();

// Messages the database raises for a bad request. Anything else is reported as unavailable so no
// internal detail reaches the caller.
const BAD_REQUEST = [
	"Pausing needs a reason",
	"The reason is too long",
	"A pause change needs the admin wallet that made it",
	"Unknown pause switch",
];

/**
 * @param {{token?: string, pool?: {query: Function}, now?: () => number, ratePerMinute?: number}} config
 * @returns {(request: Request) => Promise<Response>}
 */
export function createPauseAdminHandler({
	token,
	pool,
	now = Date.now,
	ratePerMinute = 60,
	failedPerMinute = 30,
} = {}) {
	const enabled = typeof token === "string" && token.length >= 32 && Boolean(pool);
	const expected = enabled ? sha(token) : null;
	// Two separate budgets: failed attempts must never use up the admin's own, so a flood of bad requests
	// cannot lock the admin out in an emergency.
	const budget = (limit) => {
		let windowStart = 0;
		let count = 0;
		return () => {
			const t = now();
			if (t - windowStart >= 60_000) {
				windowStart = t;
				count = 0;
			}
			return ++count > limit;
		};
	};
	const validLimited = budget(ratePerMinute);
	const failedLimited = budget(failedPerMinute);
	const authorised = (request) => {
		const header = request.headers.get("authorization") ?? "";
		const match = /^Bearer (\S{1,512})$/.exec(header);
		if (!match) return false;
		return timingSafeEqual(sha(match[1]), expected);
	};
	const readBody = async (request) => {
		const text = await request.text();
		if (text.length === 0 || text.length > MAX_BODY) return null;
		try {
			const value = JSON.parse(text);
			return value && typeof value === "object" && !Array.isArray(value) ? value : null;
		} catch {
			return null;
		}
	};
	const status = async () => (await pool.query("SELECT quest.pause_status() AS status")).rows[0].status;

	return async (request) => {
		if (!enabled) return reply(404, { error: "NOT_FOUND" });
		if (!authorised(request)) {
			return failedLimited()
				? reply(429, { error: "RATE_LIMITED" })
				: reply(401, { error: "UNAUTHORIZED" });
		}
		if (validLimited()) return reply(429, { error: "RATE_LIMITED" });
		try {
			if (request.method === "GET") return reply(200, { pauses: await status() });
			if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });
			const body = await readBody(request);
			const keys = body ? Object.keys(body).sort().join(",") : "";
			if (
				!body ||
				!["actor,key,paused", "actor,key,paused,reason"].includes(keys) ||
				!PAUSE_KEYS.includes(body.key) ||
				typeof body.paused !== "boolean" ||
				typeof body.actor !== "string" ||
				!WALLET.test(body.actor) ||
				(body.reason !== undefined && typeof body.reason !== "string") ||
				(body.paused && (!body.reason || body.reason.trim().length === 0)) ||
				(body.reason && body.reason.length > 200)
			)
				return reply(400, { error: "INVALID_REQUEST" });
			const result = (
				await pool.query("SELECT quest.set_pause($1, $2, $3, $4) AS result", [
					body.key,
					body.paused,
					body.reason ?? null,
					body.actor,
				])
			).rows[0].result;
			return reply(200, { result, pauses: await status() });
		} catch (error) {
			if (BAD_REQUEST.some((message) => error?.message?.includes(message)))
				return reply(400, { error: "INVALID_REQUEST" });
			return reply(503, { error: "UNAVAILABLE" });
		}
	};
}
