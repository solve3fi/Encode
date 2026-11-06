import {
	PassportAuthFault,
	passportAuthOrigin,
} from "./passport-durable-auth.mjs";

const bodyKeys = {
	"wallet-challenge": ["wallet"],
	challenge: ["passportId", "wallet"],
	authenticate: ["message", "signature"],
	enroll: ["message", "signature"],
	session: [],
	resume: [],
	logout: [],
	"pass-prepare": [],
	"pass-status": [],
};
const headers = {
	"Cache-Control": "no-store",
	Pragma: "no-cache",
	"Content-Type": "application/json; charset=utf-8",
	"X-Content-Type-Options": "nosniff",
};
const fault = (code) => {
	throw new PassportAuthFault(code);
};
async function body(request, timeoutMs) {
	if (
		!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
			request.headers.get("content-type") ?? "",
		)
	)
		fault("INVALID_REQUEST");
	const length = request.headers.get("content-length");
	if (
		length !== null &&
		(!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 8192)
	)
		fault("INVALID_REQUEST");
	if (!request.body) fault("INVALID_REQUEST");
	const reader = request.body.getReader();
	let timer;
	const deadline = new Promise((_, reject) => {
		timer = setTimeout(() => {
			reject(new PassportAuthFault("INVALID_REQUEST"));
			void reader.cancel().catch(() => {});
		}, timeoutMs);
	});
	let size = 0;
	const chunks = [];
	try {
		while (true) {
			const { done, value } = await Promise.race([reader.read(), deadline]);
			if (done) break;
			size += value.byteLength;
			if (size > 8192) {
				await reader.cancel();
				fault("INVALID_REQUEST");
			}
			chunks.push(value);
		}
		const value = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
		);
		if (!value || typeof value !== "object" || Array.isArray(value))
			fault("INVALID_REQUEST");
		return value;
	} catch (e) {
		if (e instanceof PassportAuthFault) throw e;
		fault("INVALID_REQUEST");
	} finally {
		clearTimeout(timer);
		reader.releaseLock();
	}
}
/** Framework-neutral adapter only; no framework route imports or activation. */
export function createPassportAuthHttpAdapter({
	auth,
	resolveClientContext,
	bodyTimeoutMs = 5000,
} = {}) {
	const origin = passportAuthOrigin(auth?.origin);
	if (
		typeof resolveClientContext !== "function" ||
		["issueChallenge", "authenticate", "readSession", "logout"].some(
			(m) => typeof auth[m] !== "function",
		)
	)
		fault("INVALID_REQUEST");
	if (
		!Number.isInteger(bodyTimeoutMs) ||
		bodyTimeoutMs < 1 ||
		bodyTimeoutMs > 10000
	)
		fault("INVALID_REQUEST");
	return async function handle(operation, request) {
		try {
			if (!Object.hasOwn(bodyKeys, operation))
				return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
					status: 404,
					headers,
				});
			if (request.method !== "POST")
				return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
					status: 405,
					headers: { ...headers, Allow: "POST" },
				});
			// Explicit Origin required on every POST. Never derive the configured origin
			// or client identity from Host/X-Forwarded-* headers supplied by a browser.
			if (request.headers.get("origin") !== origin) fault("FORBIDDEN");
			const fetchSite = request.headers.get("sec-fetch-site");
			if (
				fetchSite !== null &&
				fetchSite !== "same-origin" &&
				fetchSite !== "none"
			)
				fault("FORBIDDEN");
			const input = await body(request, bodyTimeoutMs);
			const expected = bodyKeys[operation];
			if (
				Object.keys(input).length !== expected.length ||
				expected.some((k) => !Object.hasOwn(input, k))
			)
				fault("INVALID_REQUEST");
			const resolved = await resolveClientContext(request);
			const context = { origin, clientKey: resolved?.clientKey };
			const cookieHeader = request.headers.get("cookie") ?? "";
			let value;
			if (operation === "challenge")
				value = await auth.issueChallenge(input, context);
			else if (operation === "wallet-challenge")
				value = await auth.issueWalletChallenge(input, context);
			else if (operation === "enroll")
				value = await auth.enroll(input, context);
			else if (operation === "authenticate")
				value = await auth.authenticate(input, context);
			else if (operation === "pass-prepare" || operation === "pass-status")
				value = await auth[
					operation === "pass-prepare" ? "preparePass" : "passStatus"
				](
					{ cookieHeader, csrfToken: request.headers.get("x-solve3-csrf") },
					context,
				);
			else if (operation === "resume")
				value = await auth.resume({ cookieHeader }, context);
			else if (operation === "session")
				value = await auth.readSession({ cookieHeader }, context);
			else
				value = await auth.logout(
					{ cookieHeader, csrfToken: request.headers.get("x-solve3-csrf") },
					context,
				);
			const { cookie, ...publicBody } = value;
			return new Response(JSON.stringify(publicBody), {
				status: 200,
				headers: { ...headers, ...(cookie ? { "Set-Cookie": cookie } : {}) },
			});
		} catch (e) {
			const code = e instanceof PassportAuthFault ? e.code : "UNAVAILABLE";
			const status =
				{
					INVALID_REQUEST: 400,
					UNAUTHORIZED: 401,
					FORBIDDEN: 403,
					RATE_LIMITED: 429,
					UNAVAILABLE: 503,
				}[code] ?? 503;
			return new Response(JSON.stringify({ error: code }), { status, headers });
		}
	};
}
