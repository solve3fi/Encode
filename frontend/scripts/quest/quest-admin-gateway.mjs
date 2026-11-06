// Server-side forwarder from the website's admin route to the Quest backend's /admin/quests route. The website
// has already verified that the request was signed by an admin wallet; this adds the shared bearer token and
// the verified wallet as the actor. Nothing here is reachable from a browser. The backend's short, fixed error
// sentences (for example "A goal that has started cannot change") are passed back so the admin can see why a
// change was refused; nothing else from the backend is.
//
// The backend origin is either an https origin or the backend's private Docker-network address (plain http
// with a single-label host such as http://quest-backend:8080); the public Quest origin does not route /admin/*.
const ACTIONS = ["overview", "publish", "revise", "save-goal", "remove-goal", "complete-goal", "leads", "reject-lead", "onboard-lead"];
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_BODY = 600 * 1024;

/** @param {{backendOrigin?: string, token?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} config */
export function createQuestAdminGateway({ backendOrigin, token, fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
	let url = null;
	try {
		const origin = new URL(backendOrigin);
		const privateNetworkHost = origin.protocol === "http:" && /^[a-z0-9-]+$/.test(origin.hostname) && origin.hostname !== "localhost";
		if (
			(origin.protocol === "https:" || privateNetworkHost) &&
			origin.origin === backendOrigin &&
			!origin.username &&
			!origin.password &&
			typeof token === "string" &&
			token.length >= 32
		)
			url = `${origin.origin}/admin/quests`;
	} catch {
		/* not configured */
	}

	return {
		configured: () => url !== null,
		/**
		 * @param {{action: string, actor?: string, [key: string]: unknown}} request `actor` is the verified admin wallet
		 *   (every action except overview needs it).
		 * @returns {Promise<{ok: true, status: 200, data: object} | {ok: false, status: number, error: string, detail?: string}>}
		 */
		async send(request) {
			if (!url) return { ok: false, status: 503, error: "NOT_CONFIGURED" };
			if (
				!request ||
				typeof request !== "object" ||
				!ACTIONS.includes(request.action) ||
				(!["overview", "leads"].includes(request.action) && (typeof request.actor !== "string" || !WALLET.test(request.actor)))
			)
				return { ok: false, status: 400, error: "INVALID_REQUEST" };
			const body = JSON.stringify(request);
			if (body.length > MAX_BODY) return { ok: false, status: 400, error: "INVALID_REQUEST", detail: "The request is too large" };
			let response;
			try {
				response = await fetchImpl(url, {
					method: "POST",
					headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
					body,
					signal: AbortSignal.timeout(timeoutMs),
					redirect: "error",
				});
			} catch {
				return { ok: false, status: 503, error: "UNAVAILABLE" };
			}
			let payload = null;
			try {
				payload = await response.json();
			} catch {
				/* not JSON */
			}
			if (response.ok && payload && typeof payload === "object") return { ok: true, status: 200, data: payload };
			const detail = typeof payload?.detail === "string" && payload.detail.length <= 200 ? payload.detail : undefined;
			if (response.status === 400) return { ok: false, status: 400, error: "INVALID_REQUEST", ...(detail ? { detail } : {}) };
			if (response.status === 409) return { ok: false, status: 409, error: "CONFLICT", ...(detail ? { detail } : {}) };
			return { ok: false, status: 503, error: "UNAVAILABLE" };
		},
	};
}
