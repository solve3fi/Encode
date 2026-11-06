// Server-side forwarder from the website's admin route to the Quest backend's /admin/pause route. The
// website has already verified that the request was signed by an admin wallet; this adds the shared bearer
// token and sends the verified wallet as the actor. Nothing here is reachable from a browser, and no
// backend detail is passed back: callers only ever see the switches or a short error code.
//
// The backend origin is either an https origin or the backend's private Docker-network address (plain http
// with a single-label host such as http://quest-backend:8080). The public Quest origin does not route
// /admin/pause at all, so the private address is the normal choice.
const PAUSE_KEYS = ["weekly-xp", "voting-xp", "onboarding-xp", "referrals", "pass-mint", "community-xp"];
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** @param {{backendOrigin?: string, token?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} config */
export function createQuestPauseGateway({ backendOrigin, token, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
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
			url = `${origin.origin}/admin/pause`;
	} catch {
		/* not configured */
	}

	async function send(method, body) {
		if (!url) return { ok: false, status: 503, error: "NOT_CONFIGURED" };
		let response;
		try {
			response = await fetchImpl(url, {
				method,
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
					accept: "application/json",
				},
				...(body ? { body: JSON.stringify(body) } : {}),
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
		if (response.ok && payload && typeof payload.pauses === "object" && payload.pauses !== null)
			return { ok: true, status: 200, pauses: payload.pauses, result: payload.result ?? null };
		if (response.status === 400) return { ok: false, status: 400, error: "INVALID_REQUEST" };
		if (response.status === 401) return { ok: false, status: 503, error: "UNAVAILABLE" };
		return { ok: false, status: 503, error: "UNAVAILABLE" };
	}

	return {
		configured: () => url !== null,
		read: () => send("GET"),
		/** @param {{key: string, paused: boolean, reason?: string, actor: string}} change */
		set(change) {
			if (
				!change ||
				!PAUSE_KEYS.includes(change.key) ||
				typeof change.paused !== "boolean" ||
				typeof change.actor !== "string" ||
				!WALLET.test(change.actor) ||
				(change.paused && (typeof change.reason !== "string" || change.reason.trim().length === 0)) ||
				(change.reason !== undefined && (typeof change.reason !== "string" || change.reason.length > 200))
			)
				return Promise.resolve({ ok: false, status: 400, error: "INVALID_REQUEST" });
			return send("POST", {
				key: change.key,
				paused: change.paused,
				actor: change.actor,
				...(change.reason ? { reason: change.reason.trim() } : {}),
			});
		},
	};
}
