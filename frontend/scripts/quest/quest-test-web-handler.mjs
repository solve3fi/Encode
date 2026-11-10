import { createPassportAuthHttpAdapter } from "./passport-auth-http.mjs";
import { createQuestCalendarHttpAdapter } from "./quest-calendar-http.mjs";

/** Install only in an explicitly configured isolated HTTPS Devnet test host.
 * No pool, policy, identity or deployment is created by this dispatcher. */
export function createQuestTestWebHandler({
	passService,
	auth,
	service,
	resolveClientContext,
}) {
	if (auth?.origin !== service?.origin)
		throw new Error("Quest web origins differ");
	const passport = createPassportAuthHttpAdapter({
		auth: passService
			? {
					...auth,
					preparePass: passService.prepare,
					passStatus: passService.status,
				}
			: auth,
		resolveClientContext,
	});
	const calendar = createQuestCalendarHttpAdapter({
		service,
		resolveClientContext,
	});
	return (scope, operation, request) => {
		if (scope === "passport" && !operation.startsWith("pass-"))
			return passport(operation, request);
		if (
			scope === "pass" &&
			passService &&
			["prepare", "status"].includes(operation)
		)
			return passport(`pass-${operation}`, request);
		if (scope === "calendar" && ["snapshot", "history", "xp", "referral", "redeem-referral", "partner-lead", "social-claim", "clans"].includes(operation))
			return calendar(operation, request);
		return Promise.resolve(
			new Response(JSON.stringify({ error: "NOT_FOUND" }), {
				status: 404,
				headers: {
					"Cache-Control": "no-store",
					"Content-Type": "application/json",
				},
			}),
		);
	};
}
