import {
	PassportAuthFault,
	passportAuthOrigin,
} from "./passport-durable-auth.mjs";
import { QuestCalendarFault } from "./quest-calendar-service.mjs";

const headers = {
	"Cache-Control": "no-store",
	Pragma: "no-cache",
	"Content-Type": "application/json; charset=utf-8",
	"X-Content-Type-Options": "nosniff",
};
const operations = new Set([
	"snapshot",
	"history",
	"xp",
	"referral",
	"redeem-referral",
	"partner-lead",
	"social-claim",
	"clans",
	"budget",
	"operator-plan",
	"publish",
	"revise",
	"observe",
]);
const fail = (code) => {
	throw new QuestCalendarFault(code);
};
async function readBody(request, limit, timeoutMs) {
	if (
		!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
			request.headers.get("content-type") ?? "",
		)
	)
		fail("INVALID_REQUEST");
	const length = request.headers.get("content-length");
	if (
		length !== null &&
		(!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > limit)
	)
		fail("INVALID_REQUEST");
	if (!request.body) fail("INVALID_REQUEST");
	const reader = request.body.getReader();
	let timer,
		size = 0;
	const chunks = [];
	const deadline = new Promise((_, reject) => {
		timer = setTimeout(() => {
			reject(new QuestCalendarFault("INVALID_REQUEST"));
			void reader.cancel().catch(() => {});
		}, timeoutMs);
	});
	try {
		while (true) {
			const { value, done } = await Promise.race([reader.read(), deadline]);
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				void reader.cancel().catch(() => {});
				fail("INVALID_REQUEST");
			}
			chunks.push(value);
		}
		const value = JSON.parse(
			new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks)),
		);
		if (!value || Object.getPrototypeOf(value) !== Object.prototype)
			fail("INVALID_REQUEST");
		return value;
	} catch (e) {
		if (e instanceof QuestCalendarFault) throw e;
		fail("INVALID_REQUEST");
	} finally {
		clearTimeout(timer);
		reader.releaseLock();
	}
}
/** This adapter registers no route. Host/proxy and browser headers cannot
 * supply the trusted client identity or change the configured HTTPS origin. */
export function createQuestCalendarHttpAdapter({
	service,
	resolveClientContext,
	bodyTimeoutMs = 5000,
}) {
	const origin = passportAuthOrigin(service?.origin);
	if (
		typeof resolveClientContext !== "function" ||
		["snapshot", "history", "budget", "operatorPlan", "mutate"].some(
			(m) => typeof service[m] !== "function",
		) ||
		!Number.isSafeInteger(bodyTimeoutMs) ||
		bodyTimeoutMs < 1 ||
		bodyTimeoutMs > 10000
	)
		fail("INVALID_REQUEST");
	return async (operation, request) => {
		try {
			if (!operations.has(operation)) fail("NOT_FOUND");
			if (request.method !== "POST")
				return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
					status: 405,
					headers: { ...headers, Allow: "POST" },
				});
			if (request.headers.get("origin") !== origin) fail("FORBIDDEN");
			const site = request.headers.get("sec-fetch-site");
			if (site !== null && !["same-origin", "none"].includes(site))
				fail("FORBIDDEN");
			const input = await readBody(
					request,
					["publish", "revise"].includes(operation)
						? 524288
						: operation === "observe"
							? 65536
							: 8192,
					bodyTimeoutMs,
				),
				resolved = await resolveClientContext(request);
			const context = { origin, clientKey: resolved?.clientKey },
				authentication = {
					cookieHeader: request.headers.get("cookie") ?? "",
					csrfToken: request.headers.get("x-solve3-csrf"),
				};
			const value =
				operation === "budget"
					? await service.budget(input, authentication, context)
					: operation === "history"
						? await service.history(input, authentication, context)
						: operation === "xp"
							? await service.xp(input, authentication, context)
							: operation === "referral"
								? await service.referral(input, authentication, context)
								: operation === "redeem-referral"
									? await service.redeemReferral(input, authentication, context)
									: operation === "clans"
										? await service.clans(input, authentication, context)
									: operation === "social-claim"
										? await service.socialClaim(input, authentication, context)
									: operation === "partner-lead"
										? await service.partnerLead(input, authentication, context)
									: operation === "snapshot"
							? await service.snapshot(input, authentication, context)
							: operation === "operator-plan"
								? await service.operatorPlan(input, authentication, context)
								: await service.mutate(
										operation,
										input,
										authentication,
										context,
									);
			const output = JSON.stringify(value);
			if (Buffer.byteLength(output, "utf8") > 1048576) fail("UNAVAILABLE");
			return new Response(output, { status: 200, headers });
		} catch (e) {
			const code =
				e instanceof QuestCalendarFault || e instanceof PassportAuthFault
					? e.code
					: "UNAVAILABLE";
			const status =
				{
					INVALID_REQUEST: 400,
					UNAUTHORIZED: 401,
					FORBIDDEN: 403,
					NOT_FOUND: 404,
					CONFLICT: 409,
					RATE_LIMITED: 429,
					UNAVAILABLE: 503,
				}[code] ?? 503;
			return new Response(JSON.stringify({ error: code }), { status, headers });
		}
	};
}
