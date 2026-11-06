// Admin endpoint for the Quest calendar and the manual community goals (migration 024). Like the pause route
// it is NOT part of the public gateway: only the website's own server calls it, with a long shared bearer
// token, after the website has verified that a signed request came from an admin wallet. It uses its own
// database login (quest admin): the calendar store's publish/revise and the manual goal functions, and
// nothing else. Without a token (or a pool) the route does not exist.
import { createHash, timingSafeEqual } from "node:crypto";
import { createQuestCalendarStore } from "./quest-calendar-store.mjs";

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BODY = 640 * 1024; // a full-year plan is up to 512 KiB
const headers = {
	"Content-Type": "application/json",
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
const sha = (value) => createHash("sha256").update(value).digest();

// Messages the database raises for a bad goal request. They are fixed sentences without internal detail, so they
// are shown to the admin; anything else is reported as unavailable.
const GOAL_MESSAGES = [
	"Every goal field is required",
	"A goal cannot end in the past",
	"A completed goal cannot change",
	"A goal that has started cannot change",
	"Unknown goal",
	"A completed goal cannot be removed",
	"A goal that has started cannot be removed",
	"Community XP is paused",
	"The note is too long",
	"This goal is already completed",
	"The goal is outside its window",
	"The audience is larger than the fixture limit",
	"Unknown lead",
	"This lead is already decided",
	"This partner has already paid a bounty",
];
const CALENDAR_PREFIX = "Quest calendar: ";
// Calendar store messages that mean the server or database is wrong, not the request.
const CALENDAR_SERVER_FAULTS = new Set([
	"database environment differs",
	"stored calendar differs",
	"stored milestone differs",
	"stored weekly history differs",
]);

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const hasOnly = (v, keys) => isObject(v) && Object.keys(v).every((k) => keys.includes(k));
const isoDate = (v) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString() === v;

/**
 * @param {{token?: string, pool?: {query: Function, connect: Function}, environment?: object, now?: () => number,
 *   ratePerMinute?: number, failedPerMinute?: number}} config
 * @returns {(request: Request) => Promise<Response>}
 */
export function createQuestAdminHandler({
	token,
	pool,
	environment,
	now = Date.now,
	ratePerMinute = 60,
	failedPerMinute = 30,
} = {}) {
	const enabled = typeof token === "string" && token.length >= 32 && Boolean(pool) && Boolean(environment);
	const expected = enabled ? sha(token) : null;
	const store = enabled ? createQuestCalendarStore({ pool, environment }) : null;
	// Separate budgets so a flood of bad requests never uses up the admin's own.
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
		const match = /^Bearer (\S{1,512})$/.exec(request.headers.get("authorization") ?? "");
		return match ? timingSafeEqual(sha(match[1]), expected) : false;
	};
	const readBody = async (request) => {
		const text = await request.text();
		if (text.length === 0 || text.length > MAX_BODY) return null;
		try {
			const value = JSON.parse(text);
			return isObject(value) ? value : null;
		} catch {
			return null;
		}
	};
	const goals = async (campaignId) =>
		(await pool.query("SELECT quest.manual_goals_admin($1) AS goals", [campaignId])).rows[0].goals;
	const plan = async (campaignId) => {
		try {
			return await store.operatorPlan(campaignId);
		} catch (error) {
			if (error?.message === `${CALENDAR_PREFIX}calendar not published`) return null;
			throw error;
		}
	};
	const campaignOf = (body) => (typeof body.campaignId === "string" && ID.test(body.campaignId) ? body.campaignId : null);
	const actorOf = (body) => (typeof body.actor === "string" && WALLET.test(body.actor) ? body.actor : null);

	const actions = {
		async overview(body) {
			const campaignId = hasOnly(body, ["action", "campaignId"]) && campaignOf(body);
			if (!campaignId) return reply(400, { error: "INVALID_REQUEST" });
			return reply(200, { campaignId, plan: await plan(campaignId), goals: await goals(campaignId) });
		},
		async publish(body) {
			if (!hasOnly(body, ["action", "plan", "actor"]) || !isObject(body.plan) || !actorOf(body))
				return reply(400, { error: "INVALID_REQUEST" });
			const result = await store.publish(body.plan, { actor: actorOf(body) });
			return reply(200, { result, plan: await plan(body.plan.campaignId) });
		},
		async revise(body) {
			if (
				!hasOnly(body, ["action", "plan", "expectedRevision", "actor"]) ||
				!isObject(body.plan) ||
				!Number.isSafeInteger(body.expectedRevision) ||
				!actorOf(body)
			)
				return reply(400, { error: "INVALID_REQUEST" });
			const result = await store.revise(body.plan, { expectedRevision: body.expectedRevision, actor: actorOf(body) });
			return reply(200, { result, plan: await plan(body.plan.campaignId) });
		},
		async "save-goal"(body) {
			const campaignId = campaignOf(body);
			const goal = body.goal;
			if (
				!hasOnly(body, ["action", "campaignId", "goal", "actor"]) ||
				!campaignId ||
				!actorOf(body) ||
				!hasOnly(goal, ["id", "title", "flavorText", "startsAt", "endsAt", "xp"]) ||
				typeof goal.id !== "string" ||
				!ID.test(goal.id) ||
				typeof goal.title !== "string" ||
				goal.title.length < 1 ||
				goal.title.length > 100 ||
				typeof goal.flavorText !== "string" ||
				goal.flavorText.length < 1 ||
				goal.flavorText.length > 300 ||
				!isoDate(goal.startsAt) ||
				!isoDate(goal.endsAt) ||
				!Number.isSafeInteger(goal.xp) ||
				goal.xp < 1 ||
				goal.xp > 100000
			)
				return reply(400, { error: "INVALID_REQUEST" });
			const result = (
				await pool.query("SELECT quest.save_manual_goal($1,$2,$3,$4,$5,$6,$7,$8) AS result", [
					campaignId,
					goal.id,
					goal.title,
					goal.flavorText,
					goal.startsAt,
					goal.endsAt,
					goal.xp,
					body.actor,
				])
			).rows[0].result;
			return reply(200, { result, goals: await goals(campaignId) });
		},
		async "remove-goal"(body) {
			const campaignId = campaignOf(body);
			if (
				!hasOnly(body, ["action", "campaignId", "goalId", "actor"]) ||
				!campaignId ||
				!actorOf(body) ||
				typeof body.goalId !== "string" ||
				!ID.test(body.goalId)
			)
				return reply(400, { error: "INVALID_REQUEST" });
			const result = (
				await pool.query("SELECT quest.remove_manual_goal($1,$2,$3) AS result", [campaignId, body.goalId, body.actor])
			).rows[0].result;
			return reply(200, { result, goals: await goals(campaignId) });
		},
		// Partner Scout leads (migration 025): list, reject, or mark onboarded (which pays the scout the bounty).
		async leads(body) {
			if (!hasOnly(body, ["action"])) return reply(400, { error: "INVALID_REQUEST" });
			const view = (await pool.query("SELECT quest.partner_leads_admin() AS view")).rows[0].view;
			return reply(200, { bountyXp: view.bountyXp, leads: view.leads });
		},
		async "reject-lead"(body) {
			if (
				!hasOnly(body, ["action", "leadId", "note", "actor"]) ||
				!actorOf(body) ||
				!Number.isSafeInteger(body.leadId) ||
				body.leadId < 1 ||
				(body.note !== undefined && (typeof body.note !== "string" || body.note.length > 200))
			)
				return reply(400, { error: "INVALID_REQUEST" });
			const result = (
				await pool.query("SELECT quest.reject_partner_lead($1,$2,$3) AS result", [body.leadId, body.actor, body.note ?? null])
			).rows[0].result;
			const view = (await pool.query("SELECT quest.partner_leads_admin() AS view")).rows[0].view;
			return reply(200, { result, bountyXp: view.bountyXp, leads: view.leads });
		},
		async "onboard-lead"(body) {
			if (
				!hasOnly(body, ["action", "leadId", "note", "actor"]) ||
				!actorOf(body) ||
				!Number.isSafeInteger(body.leadId) ||
				body.leadId < 1 ||
				(body.note !== undefined && (typeof body.note !== "string" || body.note.length > 200))
			)
				return reply(400, { error: "INVALID_REQUEST" });
			const result = (
				await pool.query("SELECT quest.onboard_partner_lead($1,$2,$3) AS result", [body.leadId, body.actor, body.note ?? null])
			).rows[0].result;
			const view = (await pool.query("SELECT quest.partner_leads_admin() AS view")).rows[0].view;
			return reply(200, { result, bountyXp: view.bountyXp, leads: view.leads });
		},
		async "complete-goal"(body) {
			const campaignId = campaignOf(body);
			if (
				!hasOnly(body, ["action", "campaignId", "goalId", "note", "actor"]) ||
				!campaignId ||
				!actorOf(body) ||
				typeof body.goalId !== "string" ||
				!ID.test(body.goalId) ||
				(body.note !== undefined && (typeof body.note !== "string" || body.note.length > 200))
			)
				return reply(400, { error: "INVALID_REQUEST" });
			const result = (
				await pool.query("SELECT quest.complete_manual_goal($1,$2,$3,$4) AS result", [
					campaignId,
					body.goalId,
					body.actor,
					body.note ?? null,
				])
			).rows[0].result;
			return reply(200, { result, goals: await goals(campaignId) });
		},
	};

	return async (request) => {
		if (!enabled) return reply(404, { error: "NOT_FOUND" });
		if (!authorised(request))
			return failedLimited() ? reply(429, { error: "RATE_LIMITED" }) : reply(401, { error: "UNAUTHORIZED" });
		if (validLimited()) return reply(429, { error: "RATE_LIMITED" });
		if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });
		try {
			const body = await readBody(request);
			if (!body || typeof body.action !== "string" || !Object.hasOwn(actions, body.action))
				return reply(400, { error: "INVALID_REQUEST" });
			return await actions[body.action](body);
		} catch (error) {
			const message = typeof error?.message === "string" ? error.message : "";
			if (message === `${CALENDAR_PREFIX}calendar revision conflict`)
				return reply(409, { error: "CONFLICT", detail: "calendar revision conflict" });
			if (message.startsWith(CALENDAR_PREFIX) && !CALENDAR_SERVER_FAULTS.has(message.slice(CALENDAR_PREFIX.length)))
				return reply(400, { error: "INVALID_REQUEST", detail: message.slice(CALENDAR_PREFIX.length) });
			const known = GOAL_MESSAGES.find((m) => message.includes(m));
			if (known) return reply(400, { error: "INVALID_REQUEST", detail: known });
			if (/violates check constraint/.test(message)) return reply(400, { error: "INVALID_REQUEST" });
			return reply(503, { error: "UNAVAILABLE" });
		}
	};
}
