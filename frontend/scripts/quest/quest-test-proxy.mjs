const operations = {
	passport: [
		"wallet-challenge",
		"authenticate",
		"enroll",
		"session",
		"resume",
		"logout",
	],
	calendar: ["snapshot", "history", "xp", "referral", "redeem-referral", "partner-lead", "social-claim"],
	pass: ["prepare", "status"],
};
const headers = {
	"Cache-Control": "no-store",
	"Content-Type": "application/json",
	"X-Content-Type-Options": "nosniff",
};
const error = (code, status) =>
	new Response(JSON.stringify({ error: code }), { status, headers });
async function bounded(body, limit, signal) {
	if (!body) throw new Error("missing body");
	const reader = body.getReader(),
		chunks = [];
	const abort = () => {
		void reader.cancel().catch(() => {});
	};
	signal?.addEventListener("abort", abort, { once: true });
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (signal?.aborted) throw new Error("deadline");
			if (done) break;
			size += value.byteLength;
			if (size > limit) throw new Error("body limit");
			chunks.push(value);
		}
		return new TextDecoder("utf8", { fatal: true }).decode(
			Buffer.concat(chunks),
		);
	} finally {
		signal?.removeEventListener("abort", abort);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

/** Server-only read/auth gateway. Configuration is never taken from a browser.
 * No configuration means disabled. No operator mutation can traverse this URL.
 * @param {{enabled?:boolean,webOrigin?:string,backendOrigin?:string,fetchImpl?:typeof fetch}} config */
export function createQuestTestProxy({
	enabled = false,
	webOrigin,
	backendOrigin,
	fetchImpl = fetch,
} = {}) {
	let configured = false;
	try {
		const web = new URL(webOrigin),
			backend = new URL(backendOrigin);
		configured =
			enabled === true &&
			web.protocol === "https:" &&
			backend.protocol === "https:" &&
			web.origin === webOrigin &&
			backend.origin === backendOrigin &&
			!web.username &&
			!web.password &&
			!backend.username &&
			!backend.password &&
			webOrigin !== backendOrigin;
	} catch {
		/* disabled */
	}
	return async (scope, operation, request) => {
		if (
			!Object.hasOwn(operations, scope) ||
			!operations[scope].includes(operation)
		)
			return error("NOT_FOUND", 404);
		if (!configured) return error("UNAVAILABLE", 503);
		if (request.method !== "POST") return error("METHOD_NOT_ALLOWED", 405);
		if (
			request.headers.get("origin") !== webOrigin ||
			![null, "same-origin", "none"].includes(
				request.headers.get("sec-fetch-site"),
			)
		)
			return error("FORBIDDEN", 403);
		if (
			!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
				request.headers.get("content-type") ?? "",
			)
		)
			return error("INVALID_REQUEST", 400);
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 5000);
		try {
			// Race the whole request, not just headers. Fetch must honor abort.
			const work = async () => {
				const body = await bounded(request.body, 8192, controller.signal);
				JSON.parse(body);
				const forwarded = {
					"Content-Type": "application/json",
					Origin: webOrigin,
				};
				for (const key of ["cookie", "x-solve3-csrf"]) {
					const v = request.headers.get(key);
					if (v) {
						if (v.length > 8192) throw new Error("header limit");
						if (key === "cookie") {
							const selected = v
								.split(";")
								.map((c) => c.trim())
								.filter((c) => c.startsWith("solve3_passport="));
							if (selected.length > 1) throw new Error("duplicate cookie");
							if (selected.length) forwarded.cookie = selected[0];
						} else forwarded[key] = v;
					}
				}
				const response = await fetchImpl(
					`${backendOrigin}/${scope}/${operation}`,
					{
						method: "POST",
						body,
						headers: forwarded,
						redirect: "error",
						cache: "no-store",
						signal: controller.signal,
					},
				);
				if (
					!response.headers.get("content-type")?.startsWith("application/json")
				)
					throw new Error("response type");
				const content = await bounded(
						response.body,
						1048576,
						controller.signal,
					),
					value = JSON.parse(content);
				if (response.status !== 200) {
					const statuses = {
						INVALID_REQUEST: 400,
						UNAUTHORIZED: 401,
						FORBIDDEN: 403,
						NOT_FOUND: 404,
						RATE_LIMITED: 429,
						UNAVAILABLE: 503,
					};
					return error(
						Object.hasOwn(statuses, value?.error) ? value.error : "UNAVAILABLE",
						statuses[value?.error] ?? 503,
					);
				}
				const outgoing = { ...headers };
				const cookie = response.headers.get("set-cookie");
				if (cookie) {
					if (
						scope !== "passport" ||
						!["authenticate", "enroll", "logout"].includes(operation) ||
						!/^solve3_passport=[A-Za-z0-9_-]*; Max-Age=[0-9]{1,8}; Path=\/; Secure; SameSite=Strict; HttpOnly$/.test(
							cookie,
						)
					)
						throw new Error("cookie scope");
					outgoing["Set-Cookie"] = cookie;
				}
				return new Response(content, { status: 200, headers: outgoing });
			};
			return await Promise.race([
				work(),
				new Promise((_, reject) => {
					controller.signal.addEventListener(
						"abort",
						() => reject(new Error("deadline")),
						{ once: true },
					);
				}),
			]);
		} catch {
			return error("UNAVAILABLE", 503);
		} finally {
			clearTimeout(timer);
		}
	};
}
