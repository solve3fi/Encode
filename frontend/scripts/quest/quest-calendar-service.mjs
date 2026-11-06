import { PassportAuthFault } from "./passport-durable-auth.mjs";
import { assertPassportId } from "./passport-id.mjs";
import {
	calendarHash,
	compileQuestCalendar,
	previewWeeklyQuests,
	WEEKLY_METRICS,
} from "./quest-calendar.mjs";
import { validateHistoryPage } from "./quest-calendar-history.mjs";
import { createQuestCalendarStore } from "./quest-calendar-store.mjs";
import { projectWeeklyLiquidityProgress } from "./quest-weekly-liquidity-progress.mjs";
import { projectWeeklySwapProgress } from "./quest-weekly-swap-progress.mjs";

export class QuestCalendarFault extends PassportAuthFault {
	constructor(code) {
		super(code);
		this.name = "QuestCalendarFault";
		this.code = code;
	}
}
const fail = (code) => {
	throw new QuestCalendarFault(code);
};
function id(v) {
	if (typeof v !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v))
		fail("INVALID_REQUEST");
	return v;
}
function exact(v, keys) {
	if (
		!v ||
		Object.getPrototypeOf(v) !== Object.prototype ||
		Object.keys(v).sort().join("|") !== keys.split(" ").sort().join("|")
	)
		fail("INVALID_REQUEST");
}
const operations = {
	publish: "requestId plan",
	revise: "requestId plan expectedRevision",
	observe: "requestId campaignId goalId proof",
};
function summarizeMilestone(out) {
	const r = out.receipt;
	return {
		created: out.created,
		historical: out.historical,
		campaignId: r.campaignId,
		goalId: r.goalId,
		reached: r.reached,
		observedTvlUsdCents: r.observedTvlUsdCents,
		recipientCount: r.entitlements.length,
		receiptSha256: r.reached ? calendarHash(r) : null,
		awardEligible: false,
	};
}

/** Dormant trusted-server service. All state changes and audit receipts use
 * the same protected SQL connection as the current Passport session. */
/**
 * Quest XP of one Passport: everything in the XP ledger EXCEPT governance (Voting XP), which has its
 * own counter. A reversal belongs to the kind of the event it reverses.
 */
export const QUEST_XP_TOTAL_SQL =
	"SELECT COALESCE(sum(e.xp_delta),0)::int AS total FROM quest.xp_events e LEFT JOIN quest.xp_events o ON o.event_id=e.reverses_event_id WHERE e.network='DEVNET' AND e.passport_id=$1 AND COALESCE(e.qualification_key,o.qualification_key) IS DISTINCT FROM 'governance-epoch'";

export function createQuestCalendarService({
	auth,
	environment,
	weeklyProgressProvider,
	weeklyLiquidityProvider,
	progressTimeoutMs = 3000,
	progressMaxAgeMs = 300000,
	requireCommunityBudget = false,
}) {
	if (typeof auth?.withSession !== "function") fail("INVALID_REQUEST");
	// Validate configuration without borrowing or opening a live connection.
	createQuestCalendarStore({
		environment,
		requireCommunityBudget,
		runInTransaction: () => {
			throw new Error("Unused validation executor");
		},
	});
	const pins = structuredClone(environment);
	if (
		weeklyLiquidityProvider !== undefined &&
		(typeof weeklyLiquidityProvider?.read !== "function" ||
			weeklyLiquidityProvider.sourcePins?.environmentId !==
				pins.environmentId ||
			weeklyLiquidityProvider.sourcePins?.manifestSha256 !==
				pins.manifestSha256)
	)
		fail("INVALID_REQUEST");
	const liquidityPins = weeklyLiquidityProvider
		? structuredClone(weeklyLiquidityProvider.sourcePins)
		: null;
	if (
		weeklyProgressProvider !== undefined &&
		(typeof weeklyProgressProvider?.read !== "function" ||
			weeklyProgressProvider.sourcePins?.environmentId !== pins.environmentId ||
			weeklyProgressProvider.sourcePins?.manifestSha256 !== pins.manifestSha256)
	)
		fail("INVALID_REQUEST");
	if (
		!Number.isSafeInteger(progressTimeoutMs) ||
		progressTimeoutMs < 1 ||
		progressTimeoutMs > 3000 ||
		!Number.isSafeInteger(progressMaxAgeMs) ||
		progressMaxAgeMs < 1 ||
		progressMaxAgeMs > 300000
	)
		fail("INVALID_REQUEST");
	const progressPins = weeklyProgressProvider
		? structuredClone(weeklyProgressProvider.sourcePins)
		: null;
	async function protect(authentication, context, work) {
		const mapped = (e) => {
			if (e instanceof PassportAuthFault) return e;
			if (e?.message === "Community test budget exceeded")
				return new QuestCalendarFault("CONFLICT");
			if (e?.message === "Quest calendar: calendar revision conflict")
				return new QuestCalendarFault("CONFLICT");
			if (e?.message === "Quest calendar: calendar not published")
				return new QuestCalendarFault("NOT_FOUND");
			if (
				typeof e?.message === "string" &&
				e.message.startsWith("Quest calendar: ") &&
				![
					"database environment differs",
					"stored calendar differs",
					"stored milestone differs",
					"personal milestone differs",
					"personal entitlement differs",
					"milestone value differs",
					"milestone scope differs",
					"stored weekly history differs",
					"stored community budget differs",
					"community test policy not provisioned",
				].some((m) => e.message === `Quest calendar: ${m}`)
			)
				return new QuestCalendarFault("INVALID_REQUEST");
			return new QuestCalendarFault("UNAVAILABLE");
		};
		try {
			return await auth.withSession(
				authentication,
				context,
				async ({ client, session }) => {
					const store = createQuestCalendarStore({
						environment: pins,
						requireCommunityBudget,
						runInTransaction: (fn) => fn(client),
					});
					try {
						return await work({ client, session, store });
					} catch (e) {
						throw mapped(e);
					}
				},
			);
		} catch (e) {
			throw mapped(e);
		}
	}
	async function authorize(client, session, campaign, capability) {
		const { rows } = await client.query(
			"SELECT quest.lock_calendar_operator_grant($1,$2,$3) AS grant_id",
			[session.sessionId, campaign, capability],
		);
		if (rows.length !== 1 || !rows[0].grant_id) fail("FORBIDDEN");
		return rows[0].grant_id;
	}
	return Object.freeze({
		origin: auth.origin,
		async budget(input, authentication, context) {
			exact(input, "campaignId");
			id(input.campaignId);
			return protect(
				authentication,
				context,
				async ({ store, session, client }) => {
					await authorize(client, session, input.campaignId, "observe");
					const result = await store.communityBudget(input.campaignId);
					await authorize(client, session, input.campaignId, "observe");
					return result;
				},
			);
		},
		async history(input, authentication, context) {
			exact(input, "campaignId before limit");
			id(input.campaignId);
			try {
				validateHistoryPage(input);
			} catch {
				fail("INVALID_REQUEST");
			}
			const page = structuredClone({
				before: input.before,
				limit: input.limit,
			});
			return protect(authentication, context, ({ store, session }) =>
				store.weeklyHistory(input.campaignId, session.passportId, page),
			);
		},
		/** Devnet TEST XP and the two onboarding quests, read through the signed session only. */
		async xp(input, authentication, context) {
			exact(input, "campaignId");
			id(input.campaignId);
			return protect(authentication, context, async ({ client, session }) => {
				const rules = (
					await client.query(
						"SELECT quest_key,xp::int AS xp,title,description FROM quest.devnet_onboarding_rules ORDER BY quest_key",
					)
				).rows;
				const awards = (
					await client.query(
						"SELECT qualification_key,xp_delta::int AS xp,recorded_at FROM quest.xp_events WHERE network='DEVNET' AND passport_id=$1 AND kind='AWARD' AND qualification_key=ANY($2::text[])",
						[session.passportId, rules.map((r) => r.quest_key)],
					)
				).rows;
				const total = (
					await client.query(QUEST_XP_TOTAL_SQL, [session.passportId])
				).rows[0].total;
				// Voting XP (migration 020) is read through a SECURITY DEFINER function for this Passport only.
				// It sits behind a savepoint so a problem here can never break the Quest XP read above.
				let voting = null;
				try {
					await client.query("SAVEPOINT voting_overview");
					voting = (
						await client.query("SELECT quest.voting_overview($1) AS overview", [
							session.passportId,
						])
					).rows[0].overview;
					await client.query("RELEASE SAVEPOINT voting_overview");
				} catch {
					voting = null;
					await client.query("ROLLBACK TO SAVEPOINT voting_overview").catch(() => {});
				}
				// Monthly community goals (migration 024) that an operator completes by hand; same isolation as voting.
				let community = [];
				try {
					await client.query("SAVEPOINT community_goals");
					community = (
						await client.query("SELECT quest.community_goals_overview($1,$2) AS goals", [
							session.passportId,
							input.campaignId,
						])
					).rows[0].goals;
					await client.query("RELEASE SAVEPOINT community_goals");
				} catch {
					community = [];
					await client.query("ROLLBACK TO SAVEPOINT community_goals").catch(() => {});
				}
				// Partner Scout (migration 025): the bounty, the weekly allowance and this Passport's own leads.
				let partnerScout = null;
				try {
					await client.query("SAVEPOINT partner_scout");
					partnerScout = (
						await client.query("SELECT quest.partner_scout_overview($1) AS overview", [
							session.passportId,
						])
					).rows[0].overview;
					await client.query("RELEASE SAVEPOINT partner_scout");
				} catch {
					partnerScout = null;
					await client.query("ROLLBACK TO SAVEPOINT partner_scout").catch(() => {});
				}
				// Social quests (migration 026): the three one-time follow / post / join quests and what this Passport claimed.
				let social = null;
				try {
					await client.query("SAVEPOINT social_quests");
					social = (
						await client.query("SELECT quest.social_quests_overview($1) AS overview", [
							session.passportId,
						])
					).rows[0].overview;
					await client.query("RELEASE SAVEPOINT social_quests");
				} catch {
					social = null;
					await client.query("ROLLBACK TO SAVEPOINT social_quests").catch(() => {});
				}
				return {
					campaignId: input.campaignId,
					passportId: session.passportId,
					testOnly: true,
					totalXp: total,
					voting,
					community,
					partnerScout,
					social,
					onboarding: rules.map((rule) => {
						const award = awards.find(
							(a) => a.qualification_key === rule.quest_key,
						);
						return {
							id: rule.quest_key,
							title: rule.title,
							description: rule.description,
							xp: rule.xp,
							completed: Boolean(award),
							awardedAt: award
								? new Date(award.recorded_at).toISOString()
								: null,
						};
					}),
				};
			});
		},
		/** Devnet TEST referrals: your code and totals, then redeeming someone else's code once. */
		async referral(input, authentication, context) {
			exact(input, "campaignId");
			id(input.campaignId);
			return protect(authentication, context, async ({ client, session }) => {
				const { rows } = await client.query(
					"SELECT quest.referral_overview($1) AS overview",
					[session.passportId],
				);
				return {
					campaignId: input.campaignId,
					passportId: session.passportId,
					testOnly: true,
					...rows[0].overview,
				};
			});
		},
		/** Devnet TEST social quests: claim a one-time follow / post / join quest. Honor claim, small XP. */
		async socialClaim(input, authentication, context) {
			exact(input, "campaignId quest");
			id(input.campaignId);
			if (!["follow-x", "post-x", "join-discord"].includes(input.quest)) fail("INVALID_REQUEST");
			return protect(authentication, context, async ({ client, session }) => {
				let outcome;
				try {
					outcome = (
						await client.query("SELECT quest.claim_social_quest($1,$2) AS result", [
							session.passportId,
							input.quest,
						])
					).rows[0].result;
				} catch (error) {
					if (/paused/i.test(error?.message ?? "")) throw new QuestCalendarFault("UNAVAILABLE");
					if (/^Operators do not|^Unknown social/.test(error?.message ?? "")) throw new QuestCalendarFault("INVALID_REQUEST");
					throw error;
				}
				const overview = (
					await client.query("SELECT quest.social_quests_overview($1) AS overview", [session.passportId])
				).rows[0].overview;
				return {
					campaignId: input.campaignId,
					passportId: session.passportId,
					testOnly: true,
					result: outcome.result,
					social: overview,
				};
			});
		},
		/** Devnet TEST Partner Scout: send a lead for a partner Solve3 should onboard. XP is paid only if an admin onboards it. */
		async partnerLead(input, authentication, context) {
			exact(input, "campaignId name url note");
			id(input.campaignId);
			const name = typeof input.name === "string" ? input.name.trim() : "";
			const url = typeof input.url === "string" ? input.url.trim() : "";
			if (
				name.length < 2 ||
				name.length > 80 ||
				url.length < 8 ||
				url.length > 200 ||
				!/^https?:\/\/[^\s/?#]+/.test(url) ||
				typeof input.note !== "string" ||
				input.note.length > 300
			)
				fail("INVALID_REQUEST");
			return protect(authentication, context, async ({ client, session }) => {
				let outcome;
				try {
					outcome = (
						await client.query("SELECT quest.submit_partner_lead($1,$2,$3,$4) AS result", [
							session.passportId,
							name,
							url,
							input.note.trim() === "" ? null : input.note.trim(),
						])
					).rows[0].result;
				} catch (error) {
					if (error?.message === "Too many leads this week") throw new QuestCalendarFault("RATE_LIMITED");
					if (/^The partner |^The note is too long/.test(error?.message ?? "")) throw new QuestCalendarFault("INVALID_REQUEST");
					throw error;
				}
				const overview = (
					await client.query("SELECT quest.partner_scout_overview($1) AS overview", [session.passportId])
				).rows[0].overview;
				return {
					campaignId: input.campaignId,
					passportId: session.passportId,
					testOnly: true,
					result: outcome.result,
					partnerScout: overview,
				};
			});
		},
		async redeemReferral(input, authentication, context) {
			exact(input, "campaignId code");
			id(input.campaignId);
			if (typeof input.code !== "string" || !/^[A-Za-z0-9]{8}$/.test(input.code))
				fail("INVALID_REQUEST");
			return protect(authentication, context, async ({ client, session }) => {
				const outcome = (
					await client.query("SELECT quest.redeem_referral($1,$2) AS result", [
						session.passportId,
						input.code,
					])
				).rows[0].result;
				const overview = (
					await client.query("SELECT quest.referral_overview($1) AS overview", [
						session.passportId,
					])
				).rows[0].overview;
				return {
					campaignId: input.campaignId,
					passportId: session.passportId,
					testOnly: true,
					result: outcome,
					...overview,
				};
			});
		},
		async snapshot(input, authentication, context) {
			exact(input, "campaignId");
			id(input.campaignId);
			return protect(
				authentication,
				context,
				async ({ store, session, client }) => {
					const initial = await store.personalSnapshot(
						input.campaignId,
						session.passportId,
					);
					if (
						(!weeklyProgressProvider && !weeklyLiquidityProvider) ||
						!initial.weekly
					)
						return initial;
					async function read(provider) {
						if (!provider) return null;
						let timer;
						try {
							return {
								value: await Promise.race([
									Promise.resolve().then(() => provider.read()),
									new Promise((_, reject) => {
										timer = setTimeout(
											() => reject(new Error("Progress deadline")),
											progressTimeoutMs,
										);
									}),
								]),
							};
						} catch {
							return { failed: true };
						} finally {
							clearTimeout(timer);
						}
					}
					const [swap, liquidity] = await Promise.all([
						read(weeklyProgressProvider),
						read(weeklyLiquidityProvider),
					]);
					const current = await store.personalSnapshot(
						input.campaignId,
						session.passportId,
					);
					const unavailable = (state) => ({
						...current,
						...(swap
							? { progressSource: { state, awardEligible: false } }
							: {}),
						...(liquidity
							? { liquiditySource: { state, awardEligible: false } }
							: {}),
					});
					if (
						!current.weekly ||
						current.weekly.startsAt !== initial.weekly.startsAt
					)
						return unavailable("EPOCH_CHANGED");
					const loaded = await store.operatorPlan(input.campaignId),
						set = compileQuestCalendar(loaded.plan).weeks.find(
							(w) => w.startsAt === current.weekly.startsAt,
						);
					const { rows } = await client.query(
							"SELECT clock_timestamp() AS now",
						),
						nowMs = new Date(rows[0]?.now).getTime();
					const metrics = Object.fromEntries(
						WEEKLY_METRICS.map((k) => [k, null]),
					);
					const result = { ...current };
					for (const [packet, key, project, pins, argument] of [
						[
							swap,
							"progressSource",
							projectWeeklySwapProgress,
							progressPins,
							"qualification",
						],
						[
							liquidity,
							"liquiditySource",
							projectWeeklyLiquidityProgress,
							liquidityPins,
							"packet",
						],
					]) {
						if (!packet) continue;
						result[key] = { state: "UNAVAILABLE", awardEligible: false };
						if (packet.failed) continue;
						try {
							const progress = project({
								set,
								passportId: session.passportId,
								[argument]: packet.value,
								sourcePins: pins,
								nowMs,
								maxAgeMs: progressMaxAgeMs,
							});
							for (const [k, v] of Object.entries(progress.facts.metrics))
								if (v !== null) metrics[k] = v;
							result[key] = progress.source;
						} catch {
							/* Keep failed-source metrics unavailable, preserve independent sources. */
						}
					}
					// Clock may cross the boundary between refreshing the calendar and
					// projecting facts. Re-sample without reusing an expired set.
					if (
						nowMs < Date.parse(set.startsAt) ||
						nowMs >= Date.parse(set.endsAt)
					) {
						const final = await store.personalSnapshot(
							input.campaignId,
							session.passportId,
						);
						return {
							...final,
							...(swap
								? {
										progressSource: {
											state: "EPOCH_CHANGED",
											awardEligible: false,
										},
									}
								: {}),
							...(liquidity
								? {
										liquiditySource: {
											state: "EPOCH_CHANGED",
											awardEligible: false,
										},
									}
								: {}),
						};
					}
					result.weekly = previewWeeklyQuests({
						set,
						nowMs,
						facts: {
							network: "DEVNET",
							fixtureKind: "SYNTHETIC_DEVNET",
							passportId: session.passportId,
							startsAt: set.startsAt,
							endsAt: set.endsAt,
							computedAt: new Date(nowMs).toISOString(),
							metrics,
						},
					});
					return result;
				},
			);
		},
		async operatorPlan(input, authentication, context) {
			exact(input, "campaignId");
			id(input.campaignId);
			return protect(
				authentication,
				context,
				async ({ client, session, store }) => {
					await authorize(client, session, input.campaignId, "revise");
					const result = await store.operatorPlan(input.campaignId);
					await authorize(client, session, input.campaignId, "revise");
					return result;
				},
			);
		},
		async mutate(operation, input, authentication, context) {
			if (!Object.hasOwn(operations, operation)) fail("NOT_FOUND");
			exact(input, operations[operation]);
			try {
				assertPassportId(input.requestId);
				if (Buffer.byteLength(JSON.stringify(input), "utf8") > 524288)
					fail("INVALID_REQUEST");
			} catch (e) {
				if (e instanceof QuestCalendarFault) throw e;
				fail("INVALID_REQUEST");
			}
			input = structuredClone(input);
			const campaign = id(
				operation === "observe" ? input.campaignId : input.plan?.campaignId,
			);
			return protect(
				authentication,
				context,
				async ({ client, session, store }) => {
					const grantId = await authorize(client, session, campaign, operation),
						hash = calendarHash({ operation, input });
					await client.query(
						"SELECT pg_advisory_xact_lock(hashtextextended($1,61749))",
						[input.requestId],
					);
					if (operation === "observe" && requireCommunityBudget)
						await store.communityBudget(campaign);
					const { rows } = await client.query(
						"SELECT actor_passport_id,campaign_id,operation,payload_sha256,response FROM quest.calendar_operator_requests WHERE request_id=$1",
						[input.requestId],
					);
					if (rows.length) {
						const r = rows[0];
						if (
							r.actor_passport_id !== session.passportId ||
							r.campaign_id !== campaign ||
							r.operation !== operation ||
							r.payload_sha256 !== hash
						)
							fail("CONFLICT");
						await authorize(client, session, campaign, operation);
						return { ...r.response, replayed: true };
					}
					let result;
					if (operation === "publish") result = await store.publish(input.plan);
					else if (operation === "revise")
						result = await store.revise(input.plan, {
							expectedRevision: input.expectedRevision,
						});
					else
						result = summarizeMilestone(
							await store.observeCommunity({
								campaignId: campaign,
								goalId: id(input.goalId),
								proof: input.proof,
							}),
						);
					const response = { ...result, replayed: false };
					await client.query(
						"INSERT INTO quest.calendar_operator_requests(request_id,session_id,grant_id,actor_passport_id,campaign_id,operation,payload_sha256,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
						[
							input.requestId,
							session.sessionId,
							grantId,
							session.passportId,
							campaign,
							operation,
							hash,
							JSON.stringify(response),
						],
					);
					// Recheck a time-limited grant after work. Auth also rechecks the session
					// after this callback; either expiry rolls back both write and audit.
					await authorize(client, session, campaign, operation);
					return response;
				},
			);
		},
	});
}
