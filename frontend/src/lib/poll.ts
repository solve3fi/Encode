/**
 * Polling interval for react-query. Pages under /v2 poll three times slower (45 s at the least): every read goes
 * through the shared RPC pacer (one upstream call per 250 ms for the whole site), so a tab polling at the classic
 * rates used about 170 of its 240 calls per minute and slowed every page. Other pages keep their own interval.
 */
export const poll =
	(ms: number) =>
	(): number =>
		typeof window !== "undefined" && /^\/(?:[a-z]{2}\/)?(?:v2|arena)(?:\/|$)/.test(window.location.pathname)
			? Math.max(ms * 3, 45_000)
			: ms;
