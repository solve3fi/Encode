import { assertPassportId } from "./passport-id.mjs";
import {
	calendarFail,
	calendarHash,
	calendarIso,
	calendarTime,
	communityEntitlementKey,
	compileQuestCalendar,
	previewCommunityEntitlements,
	previewQuestCalendar,
	validateCalendarRevision,
	verifyCommunityProof,
} from "./quest-calendar.mjs";
import {
	readPersonalWeeklyHistory,
	validateHistoryPage,
} from "./quest-calendar-history.mjs";

const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
function campaignId(v) {
	if (typeof v !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(v))
		calendarFail("invalid campaign identifier");
	return v;
}

// Caller supplies a dedicated pool and exact reviewed environment pins. This
// factory never opens a connection, runs a timer or activates a public endpoint.
export function createQuestCalendarStore({
	pool,
	environment,
	runInTransaction,
	requireCommunityBudget = false,
}) {
	if (typeof requireCommunityBudget !== "boolean")
		calendarFail("invalid community budget configuration");
	if (
		(runInTransaction !== undefined
			? typeof runInTransaction !== "function"
			: !pool || typeof pool.connect !== "function") ||
		environment?.network !== "DEVNET" ||
		!/^[a-f0-9]{64}$/.test(environment.manifestSha256 ?? "")
	)
		calendarFail("dedicated Devnet pool and manifest required");
	assertPassportId(environment.environmentId);
	const pins = structuredClone(environment);
	async function checked(db, fn) {
		const { rows } = await db.query(
			"SELECT network,genesis_hash,environment_id,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true",
		);
		const e = rows[0];
		if (
			rows.length !== 1 ||
			e.network !== pins.network ||
			e.genesis_hash !== genesis ||
			e.environment_id !== pins.environmentId ||
			e.manifest_sha256 !== pins.manifestSha256 ||
			e.namespace !== "quest"
		)
			calendarFail("database environment differs");
		return fn(db);
	}
	async function tx(fn) {
		// Trusted server composition only: the Passport auth service owns this
		// connection/transaction and rolls back calendar writes on auth failure.
		if (runInTransaction) return runInTransaction((db) => checked(db, fn));
		const db = await pool.connect();
		let begun = false;
		try {
			await db.query("BEGIN");
			begun = true;
			const result = await checked(db, fn);
			await db.query("COMMIT");
			begun = false;
			return result;
		} catch (error) {
			if (begun) await db.query("ROLLBACK");
			throw error;
		} finally {
			await db.release();
		}
	}
	async function audit(db, actor, id, revision, action, hash) {
		if (actor === undefined) return; // Operator service already writes signed receipts.
		if (typeof actor !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(actor))
			calendarFail("authenticated admin actor required");
		await db.query(
			"INSERT INTO quest.calendar_admin_audit(campaign_id,revision,action,actor_wallet,plan_sha256) VALUES($1,$2,$3,$4,$5)",
			[id, revision, action, actor, hash],
		);
	}
	async function lock(db, id) {
		await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,61748))", [
			id,
		]);
	}
	async function load(db, id) {
		const { rows } = await db.query(
			"SELECT plan_sha256,document,revision FROM (SELECT plan_sha256,document,1 AS revision FROM quest.calendar_plans WHERE campaign_id=$1 UNION ALL SELECT plan_sha256,document,revision FROM quest.calendar_plan_revisions WHERE campaign_id=$1) versions ORDER BY revision DESC LIMIT 1",
			[campaignId(id)],
		);
		if (rows.length !== 1) calendarFail("calendar not published");
		const p = rows[0];
		compileQuestCalendar(p.document);
		if (
			p.document.campaignId !== id ||
			calendarHash(p.document) !== p.plan_sha256
		)
			calendarFail("stored calendar differs");
		return p;
	}
	async function clock(db) {
		const { rows } = await db.query("SELECT clock_timestamp() AS now");
		const n = new Date(rows[0]?.now).getTime();
		calendarTime(n);
		return n;
	}
	return Object.freeze({
		async communityBudget(id) {
			campaignId(id);
			return tx(async (db) => {
				await lock(db, id);
				await load(db, id);
				const { rows } = await db.query(
					"SELECT document FROM quest.community_test_policies WHERE campaign_id=$1",
					[id],
				);
				if (rows.length !== 1)
					calendarFail("community test policy not provisioned");
				const policy = rows[0].document;
				if (
					!policy ||
					Object.keys(policy).sort().join("|") !==
						"fixtureKind|network|perCampaignMonthXp|perCampaignYearXp|revision" ||
					policy.fixtureKind !== "SYNTHETIC_DEVNET" ||
					policy.network !== "DEVNET" ||
					policy.revision !== 1 ||
					typeof policy.perCampaignMonthXp !== "string" ||
					typeof policy.perCampaignYearXp !== "string" ||
					!/^[1-9][0-9]{0,14}$/.test(policy.perCampaignMonthXp ?? "") ||
					!/^[1-9][0-9]{0,14}$/.test(policy.perCampaignYearXp ?? "")
				)
					calendarFail("stored community budget differs");
				const { rows: totals } = await db.query(
					"SELECT to_char(month_start,'YYYY-MM-DD') AS month_start,sum(total_test_xp)::text AS total_test_xp,count(*)::integer AS goals FROM quest.community_test_reservations WHERE campaign_id=$1 GROUP BY month_start ORDER BY month_start LIMIT 1201",
					[id],
				);
				if (totals.length > 1200)
					calendarFail("stored community budget differs");
				let used = 0n;
				const months = totals.map((r) => {
					if (
						!/^\d{4}-\d{2}-01$/.test(r.month_start ?? "") ||
						!/^(0|[1-9][0-9]{0,14})$/.test(r.total_test_xp ?? "") ||
						!Number.isSafeInteger(r.goals) ||
						r.goals < 1 ||
						BigInt(r.total_test_xp) > BigInt(policy.perCampaignMonthXp)
					)
						calendarFail("stored community budget differs");
					used += BigInt(r.total_test_xp);
					return {
						startsOn: r.month_start,
						reservedTestXp: r.total_test_xp,
						remainingTestXp: (
							BigInt(policy.perCampaignMonthXp) - BigInt(r.total_test_xp)
						).toString(),
						goals: r.goals,
					};
				});
				if (used > BigInt(policy.perCampaignYearXp))
					calendarFail("stored community budget differs");
				return {
					campaignId: id,
					fixtureKind: "SYNTHETIC_DEVNET",
					awardEligible: false,
					policy,
					policySha256: calendarHash(policy),
					reservedTestXp: used.toString(),
					remainingTestXp: (BigInt(policy.perCampaignYearXp) - used).toString(),
					months,
				};
			});
		},
		async operatorPlan(id) {
			return tx(async (db) => {
				await lock(db, campaignId(id));
				const p = await load(db, id);
				return {
					plan: p.document,
					revision: p.revision,
					planSha256: p.plan_sha256,
					awardEligible: false,
				};
			});
		},
		async publish(plan, { actor } = {}) {
			compileQuestCalendar(plan);
			plan = structuredClone(plan);
			const hash = calendarHash(plan);
			return tx(async (db) => {
				await lock(db, plan.campaignId);
				const { rows } = await db.query(
					"SELECT plan_sha256,document FROM quest.calendar_plans WHERE campaign_id=$1",
					[plan.campaignId],
				);
				if (rows.length) {
					if (
						rows[0].plan_sha256 !== hash ||
						calendarHash(rows[0].document) !== hash
					)
						calendarFail("published calendar cannot be changed");
					return {
						campaignId: plan.campaignId,
						planSha256: hash,
						created: false,
						awardEligible: false,
					};
				}
				await db.query(
					"INSERT INTO quest.calendar_plans(campaign_id,plan_sha256,document) VALUES($1,$2,$3::jsonb)",
					[plan.campaignId, hash, JSON.stringify(plan)],
				);
				await audit(db, actor, plan.campaignId, 1, "PUBLISH", hash);
				return {
					campaignId: plan.campaignId,
					planSha256: hash,
					created: true,
					awardEligible: false,
				};
			});
		},
		async snapshot(id) {
			return tx(async (db) => {
				// Lock also prevents a revision from racing milestone metadata.
				await lock(db, campaignId(id));
				const p = await load(db, id);
				const out = previewQuestCalendar({
					plan: p.document,
					nowMs: await clock(db),
				});
				const { rows } = await db.query(
					"SELECT goal_id,receipt_sha256,document FROM quest.calendar_milestones WHERE campaign_id=$1 ORDER BY goal_id",
					[id],
				);
				const goals = new Map(
					compileQuestCalendar(p.document).goals.map((g) => [g.id, g]),
				);
				const milestones = rows.map((r) => {
					if (
						r.receipt_sha256 !== calendarHash(r.document) ||
						r.document.goalSha256 !== goals.get(r.goal_id)?.goalSha256 ||
						r.document.awardEligible !== false ||
						r.document.reached !== true
					)
						calendarFail("stored milestone differs");
					return {
						goalId: r.goal_id,
						reached: true,
						observedTvlUsdCents: r.document.observedTvlUsdCents,
						audienceCutoff: r.document.audienceCutoff,
						recipientCount: r.document.entitlements.length,
						receiptSha256: r.receipt_sha256,
						awardEligible: false,
					};
				});
				return {
					...out,
					revision: p.revision,
					planSha256: p.plan_sha256,
					milestones,
				};
			});
		},
		async personalSnapshot(id, passportId) {
			assertPassportId(passportId);
			return tx(async (db) => {
				await lock(db, campaignId(id));
				const p = await load(db, id);
				const out = previewQuestCalendar({
						plan: p.document,
						nowMs: await clock(db),
					}),
					goals = new Map(
						compileQuestCalendar(p.document).goals.map((g) => [g.id, g]),
					);
				// Project one recipient in SQL. Never load or return the complete
				// audience in a browser-facing snapshot.
				const { rows } = await db.query(
					`SELECT m.goal_id,m.receipt_sha256,
                 m.document->>'goalSha256' AS goal_sha256,
                 m.document->>'audienceCutoff' AS audience_cutoff,
                 m.document->>'observedTvlUsdCents' AS observed_tvl_usd_cents,
                 jsonb_array_length(m.document->'entitlements') AS recipient_count,
                 (SELECT jsonb_agg(e.value) FROM jsonb_array_elements(m.document->'entitlements') e WHERE e.value->>'passportId'=$2) AS personal_entitlements
                 FROM quest.calendar_milestones m WHERE m.campaign_id=$1 ORDER BY m.goal_id`,
					[id, passportId],
				);
				if (rows.length > goals.size) calendarFail("milestone scope differs");
				const milestones = rows.map((r) => {
					const g = goals.get(r.goal_id),
						personal = r.personal_entitlements ?? [];
					if (
						!g ||
						r.goal_sha256 !== g.goalSha256 ||
						!/^[a-f0-9]{64}$/.test(r.receipt_sha256) ||
						!Number.isSafeInteger(r.recipient_count) ||
						r.recipient_count < 0 ||
						r.recipient_count > 20000 ||
						!Array.isArray(personal) ||
						personal.length > 1
					)
						calendarFail("personal milestone differs");
					calendarIso(r.audience_cutoff);
					if (
						Date.parse(r.audience_cutoff) < Date.parse(g.startsAt) ||
						Date.parse(r.audience_cutoff) >= Date.parse(g.endsAt)
					)
						calendarFail("personal milestone differs");
					if (
						typeof r.observed_tvl_usd_cents !== "string" ||
						!/^(0|[1-9][0-9]{0,37})$/.test(r.observed_tvl_usd_cents) ||
						BigInt(r.observed_tvl_usd_cents) < BigInt(g.targetUsdCents)
					)
						calendarFail("milestone value differs");
					const e = personal[0];
					if (
						e &&
						(Object.keys(e).sort().join("|") !==
							"entitlementKey|passportId|state|testXp" ||
							e.passportId !== passportId ||
							e.entitlementKey !==
								communityEntitlementKey(id, g.id, passportId) ||
							e.testXp !== g.testXp ||
							e.state !== "PENDING_TEST_ONLY")
					)
						calendarFail("personal entitlement differs");
					return {
						goalId: g.id,
						reached: true,
						observedTvlUsdCents: r.observed_tvl_usd_cents,
						audienceCutoff: r.audience_cutoff,
						recipientCount: r.recipient_count,
						receiptSha256: r.receipt_sha256,
						entitlement: e ?? null,
						awardEligible: false,
					};
				});
				return {
					...out,
					passportId,
					revision: p.revision,
					planSha256: p.plan_sha256,
					milestones,
				};
			});
		},
		async weeklyHistory(id, passportId, page) {
			campaignId(id);
			assertPassportId(passportId);
			validateHistoryPage(page);
			return tx(async (db) => {
				await lock(db, id);
				const p = await load(db, id);
				return readPersonalWeeklyHistory({
					db,
					plan: p.document,
					passportId,
					...page,
					nowMs: await clock(db),
				});
			});
		},
		async revise(plan, { expectedRevision, actor } = {}) {
			compileQuestCalendar(plan);
			plan = structuredClone(plan);
			if (
				!Number.isSafeInteger(expectedRevision) ||
				expectedRevision < 1 ||
				expectedRevision >= 10000
			)
				calendarFail("expected revision required");
			return tx(async (db) => {
				await lock(db, plan.campaignId);
				const p = await load(db, plan.campaignId);
				if (p.revision !== expectedRevision)
					calendarFail("calendar revision conflict");
				validateCalendarRevision({
					previous: p.document,
					next: plan,
					nowMs: await clock(db),
				});
				const hash = calendarHash(plan);
				if (hash === p.plan_sha256)
					return {
						revision: p.revision,
						planSha256: hash,
						created: false,
						awardEligible: false,
					};
				await db.query(
					"INSERT INTO quest.calendar_plan_revisions(campaign_id,revision,previous_sha256,plan_sha256,document) VALUES($1,$2,$3,$4,$5::jsonb)",
					[
						plan.campaignId,
						p.revision + 1,
						p.plan_sha256,
						hash,
						JSON.stringify(plan),
					],
				);
				await audit(db, actor, plan.campaignId, p.revision + 1, "REVISE", hash);
				return {
					revision: p.revision + 1,
					planSha256: hash,
					created: true,
					awardEligible: false,
				};
			});
		},
		async observeCommunity({ campaignId: id, goalId, proof }) {
			campaignId(id);
			campaignId(goalId);
			proof = structuredClone(proof);
			return tx(async (db) => {
				await lock(db, id);
				if (requireCommunityBudget) {
					const { rows } = await db.query(
						"SELECT document FROM quest.community_test_policies WHERE campaign_id=$1",
						[id],
					);
					if (rows.length !== 1)
						calendarFail("community test policy not provisioned");
				}
				const plan = (await load(db, id)).document,
					goal = compileQuestCalendar(plan).goals.find((g) => g.id === goalId);
				if (!goal) calendarFail("unknown community goal");
				const { rows: existing } = await db.query(
					"SELECT receipt_sha256,document FROM quest.calendar_milestones WHERE campaign_id=$1 AND goal_id=$2",
					[id, goalId],
				);
				if (existing.length) {
					const r = existing[0];
					if (
						r.receipt_sha256 !== calendarHash(r.document) ||
						r.document.goalSha256 !== goal.goalSha256 ||
						r.document.campaignId !== id ||
						r.document.goalId !== goalId ||
						r.document.awardEligible !== false ||
						r.document.reached !== true
					)
						calendarFail("stored milestone differs");
					return { created: false, historical: true, receipt: r.document };
				}
				verifyCommunityProof({
					goal,
					proof,
					manifestSha256: pins.manifestSha256,
					nowMs: await clock(db),
				});
				// All canonical Passports, never a caller-selected wallet subset. The full
				// audience is captured in this single SQL statement; overflow rolls back.
				const { rows } = await db.query(
					"SELECT passport_id,created_at FROM quest.passports WHERE network=$1 AND created_at<=$2::timestamptz ORDER BY passport_id LIMIT 20001",
					["DEVNET", proof?.observedAt],
				);
				const passports = rows.map((p) => ({
					passportId: p.passport_id,
					createdAt: new Date(p.created_at).toISOString(),
				}));
				const receipt = previewCommunityEntitlements({
					campaignId: id,
					goal,
					proof,
					manifestSha256: pins.manifestSha256,
					nowMs: await clock(db),
					passports,
				});
				if (!receipt.reached)
					return { created: false, historical: false, receipt };
				await db.query(
					"INSERT INTO quest.calendar_milestones(campaign_id,goal_id,receipt_sha256,document) VALUES($1,$2,$3,$4::jsonb)",
					[id, goalId, calendarHash(receipt), JSON.stringify(receipt)],
				);
				return { created: true, historical: false, receipt };
			});
		},
	});
}
