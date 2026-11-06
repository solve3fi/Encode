import { assertPassportId } from "./passport-id.mjs";
import {
	calendarFail,
	calendarHash,
	compileQuestCalendar,
} from "./quest-calendar.mjs";
import { createQuestCalendarStore } from "./quest-calendar-store.mjs";
import { projectWeeklySwapProgress } from "./quest-weekly-swap-progress.mjs";
import {
	previewWeeklyXp,
	weeklyCompletionKey,
} from "./quest-weekly-xp-preview.mjs";

/** Trusted test worker only. No browser route or live XP capability. */
export function createWeeklyTestReceiptStore({
	pool,
	environment,
	sourcePins,
}) {
	createQuestCalendarStore({ pool, environment });
	if (
		sourcePins?.environmentId !== environment.environmentId ||
		sourcePins?.manifestSha256 !== environment.manifestSha256
	)
		calendarFail("receipt source environment differs");
	const pins = structuredClone(sourcePins),
		env = structuredClone(environment);
	async function tx(work) {
		const db = await pool.connect();
		let begun = false,
			failed = false;
		try {
			await db.query("BEGIN ISOLATION LEVEL READ COMMITTED");
			begun = true;
			await db.query("SET LOCAL statement_timeout='5000ms'");
			const store = createQuestCalendarStore({
				environment: env,
				runInTransaction: (fn) => fn(db),
			});
			const out = await work(db, store);
			await db.query("COMMIT");
			begun = false;
			return out;
		} catch (e) {
			failed = true;
			if (begun) {
				try {
					await db.query("ROLLBACK");
				} catch {
					/* discard failed client */
				}
			}
			throw e;
		} finally {
			await db.release(
				failed ? new Error("Weekly test transaction failed") : undefined,
			);
		}
	}
	async function history(db, campaignId) {
		const { rows } = await db.query(
			"SELECT campaign_id,starts_at,slot,passport_id,instance_key,test_xp,completion_key,set_sha256,facts_sha256,qualification_sha256,source_captured_at,recorded_at,fixture_kind,award_eligible FROM quest.weekly_test_receipts WHERE campaign_id=$1 ORDER BY starts_at,slot,passport_id LIMIT 20001",
			[campaignId],
		);
		if (rows.length > 20000)
			calendarFail("complete bounded receipt history required");
		return rows.map((r) => {
			const p = {
				campaignId: r.campaign_id,
				startsAt: new Date(r.starts_at).toISOString(),
				slot: r.slot,
				passportId: r.passport_id,
				instanceKey: r.instance_key,
				testXp: r.test_xp,
				completionKey: r.completion_key,
			};
			if (
				r.fixture_kind !== "SYNTHETIC_DEVNET" ||
				r.award_eligible !== false ||
				p.completionKey !==
					weeklyCompletionKey(p.campaignId, p.instanceKey, p.passportId)
			)
				calendarFail("stored test receipt differs");
			return {
				plan: p,
				receipt: {
					...p,
					fixtureKind: r.fixture_kind,
					awardEligible: false,
					setSha256: r.set_sha256,
					factsSha256: r.facts_sha256,
					qualificationSha256: r.qualification_sha256,
					sourceCapturedAt: new Date(r.source_captured_at).toISOString(),
					recordedAt: new Date(r.recorded_at).toISOString(),
				},
			};
		});
	}
	return Object.freeze({
		async reserve({ campaignId, passportId, qualification }) {
			assertPassportId(passportId);
			qualification = structuredClone(qualification);
			return tx(async (db, store) => {
				// All writers and calendar editors take this same campaign lock first.
				const loaded = await store.operatorPlan(campaignId);
				const { rows: policyRows } = await db.query(
					"SELECT document FROM quest.weekly_test_policies WHERE campaign_id=$1",
					[campaignId],
				);
				if (policyRows.length !== 1)
					calendarFail("test policy not provisioned");
				const previous = await history(db, campaignId);
				if (qualification?.lp?.ownershipCoverage === "HISTORICAL_COVERAGE") {
					const proof = qualification.lp.ownershipProof;
					let valid = false;
					if (proof?.campaignId === pins.campaignId && proof.computedThroughSlot === qualification.computedThroughSlot &&
                        /^[0-9]{1,2}$/.test(proof.inventoryRevision ?? "") && Array.isArray(proof.sources) && proof.sources.length>=1 && proof.sources.length<=17 &&
                        proof.sources.every(s=>typeof s.campaignId==="string" && /^[a-f0-9]{64}$/.test(s.anchorSha256 ?? "") && /^[0-9]{1,18}$/.test(s.coverageRevision ?? ""))) {
                        const result=await db.query("SELECT quest.lock_lp_inventory_source($1,$2,$3::jsonb,$4) AS valid",
                            [pins.campaignId,proof.inventoryRevision,JSON.stringify(proof.sources),proof.computedThroughSlot]);
                        valid=result.rows[0]?.valid===true;
                    } else if (proof?.campaignId === pins.campaignId && proof.computedThroughSlot === qualification.computedThroughSlot &&
						/^[a-f0-9]{64}$/.test(proof.anchorSha256 ?? "") && /^[0-9]{1,18}$/.test(proof.coverageRevision ?? "")) {
						const result = await db.query("SELECT quest.lock_lp_test_source($1,$2,$3,$4) AS valid",
							[pins.campaignId,proof.anchorSha256,proof.coverageRevision,proof.computedThroughSlot]);
						valid = result.rows[0]?.valid === true;
					}
					if (!valid) qualification.lp = null; // Preserve independently checked swap progress.
				}
				// Retain a shared source cursor lock through reservation commit. Late
				// evidence/conflict invalidation must finish before us or wait until after.
				const { rows: cursors } = await db.query(
					"SELECT * FROM quest.lock_weekly_test_source($1)",
					[pins.campaignId],
				);
				const c = cursors[0],
					context = qualification?.sourceContext;
				if (
					cursors.length !== 1 ||
					c.program_id !== pins.programId ||
					c.decoder_version !== pins.decoderVersion ||
					c.reconciliation_start_slot === null ||
					Number(c.reconciliation_start_slot) !== pins.startSlot ||
					c.reconciled_through_slot === null ||
					Number(c.next_slot) !== context?.nextSlot ||
					Number(c.reconciled_through_slot) !== context?.reconciledThroughSlot
				)
					calendarFail("current source prefix differs");
				const { rows: clocks } = await db.query(
						"SELECT clock_timestamp() AS now",
					),
					nowMs = new Date(clocks[0]?.now).getTime();
				const set = compileQuestCalendar(loaded.plan).weeks.find(
					(w) =>
						Date.parse(w.startsAt) <= nowMs && nowMs < Date.parse(w.endsAt),
				);
				if (!set) calendarFail("no active weekly set");
				const progress = projectWeeklySwapProgress({
					set,
					passportId,
					qualification,
					sourcePins: pins,
					nowMs,
				});
				const preview = previewWeeklyXp({
					set,
					facts: progress.facts,
					nowMs,
					policy: policyRows[0].document,
					priorPlans: previous.map((r) => r.plan),
				});
				let created = 0;
				for (const q of preview.results.filter(
					(q) => q.state === "PENDING_TEST_ONLY",
				)) {
					await db.query(
						`INSERT INTO quest.weekly_test_receipts(campaign_id,starts_at,slot,passport_id,instance_key,completion_key,test_xp,set_sha256,facts_sha256,qualification_sha256,source_captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
						[
							campaignId,
							set.startsAt,
							q.slot,
							passportId,
							q.instanceKey,
							q.completionKey,
							q.testXp,
							set.setSha256,
							calendarHash(progress.facts),
							progress.source.qualificationSha256,
							progress.source.capturedAt,
						],
					);
					created++;
				}
				const receipts = (await history(db, campaignId))
					.filter((r) => r.plan.passportId === passportId)
					.map((r) => r.receipt);
				return { ...preview, created, receipts };
			});
		},
		// Trusted server projection only; caller must authenticate Passport before
		// exposing this history. Expired reservations remain historical test data.
		async personalHistory(campaignId, passportId) {
			assertPassportId(passportId);
			return tx(async (db, store) => {
				await store.operatorPlan(campaignId);
				return (await history(db, campaignId))
					.filter((r) => r.plan.passportId === passportId)
					.map((r) => r.receipt);
			});
		},
	});
}
