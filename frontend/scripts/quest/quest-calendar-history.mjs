import { assertPassportId } from "./passport-id.mjs";
import {
	calendarFail,
	calendarHash,
	calendarIso,
	compileQuestCalendar,
} from "./quest-calendar.mjs";
import { weeklyCompletionKey } from "./quest-weekly-xp-preview.mjs";

export function validateHistoryPage({ before, limit }) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
		calendarFail("invalid history page");
	if (before !== null) {
		if (
			!before ||
			Object.getPrototypeOf(before) !== Object.prototype ||
			Object.keys(before).sort().join("|") !== "slot|startsAt"
		)
			calendarFail("invalid history cursor");
		calendarIso(before.startsAt);
		if (
			!Number.isSafeInteger(before.slot) ||
			before.slot < 0 ||
			before.slot > 2 ||
			new Date(before.startsAt).getUTCDay() !== 4 ||
			!before.startsAt.endsWith("T00:00:00.000Z")
		)
			calendarFail("invalid history cursor");
	}
}

/** Called only inside a checked environment/current authenticated transaction.
 * SQL fetches one Passport's bounded page, never the campaign recipient list. */
export async function readPersonalWeeklyHistory({
	db,
	plan,
	passportId,
	before,
	limit,
	nowMs,
}) {
	assertPassportId(passportId);
	validateHistoryPage({ before, limit });
	const calendar = compileQuestCalendar(plan);
	const { rows } = await db.query(
		"SELECT campaign_id,starts_at,slot,passport_id,instance_key,completion_key,test_xp,set_sha256,facts_sha256,qualification_sha256,source_captured_at,recorded_at,fixture_kind,award_eligible FROM quest.weekly_test_receipts WHERE campaign_id=$1 AND passport_id=$2 AND ($3::timestamptz IS NULL OR (starts_at,slot)<($3::timestamptz,$4::integer)) ORDER BY starts_at DESC,slot DESC LIMIT $5",
		[
			calendar.campaignId,
			passportId,
			before?.startsAt ?? null,
			before?.slot ?? null,
			limit + 1,
		],
	);
	if (rows.length > limit + 1) calendarFail("stored weekly history differs");
	let previous = before;
	const checked = rows.map((r) => {
		if (!r || !Number.isSafeInteger(r.slot) || r.slot < 0 || r.slot > 2)
			calendarFail("stored weekly history differs");
		const startsAt = new Date(r.starts_at).toISOString();
		const set = calendar.weeks.find((w) => w.startsAt === startsAt);
		const instance = calendarHash([
			"weekly",
			calendar.campaignId,
			startsAt,
			r.slot,
		]);
		const sourceCapturedAt = new Date(r.source_captured_at).toISOString();
		const recordedAt = new Date(r.recorded_at).toISOString();
		if (
			!set ||
			r.campaign_id !== calendar.campaignId ||
			r.passport_id !== passportId ||
			!Number.isSafeInteger(r.slot) ||
			r.slot < 0 ||
			r.slot > 2 ||
			r.test_xp !== set.quests[r.slot].testXp ||
			r.set_sha256 !== set.setSha256 ||
			r.instance_key !== instance ||
			r.completion_key !==
				weeklyCompletionKey(calendar.campaignId, instance, passportId) ||
			r.fixture_kind !== "SYNTHETIC_DEVNET" ||
			r.award_eligible !== false ||
			!/^[a-f0-9]{64}$/.test(r.facts_sha256 ?? "") ||
			!/^[a-f0-9]{64}$/.test(r.qualification_sha256 ?? "") ||
			Date.parse(sourceCapturedAt) < Date.parse(startsAt) ||
			Date.parse(sourceCapturedAt) > Date.parse(recordedAt) ||
			Date.parse(recordedAt) >= Date.parse(set.endsAt) ||
			Date.parse(recordedAt) > nowMs ||
			(previous &&
				(startsAt > previous.startsAt ||
					(startsAt === previous.startsAt && r.slot >= previous.slot)))
		)
			calendarFail("stored weekly history differs");
		previous = { startsAt, slot: r.slot };
		return {
			campaignId: calendar.campaignId,
			startsAt,
			endsAt: set.endsAt,
			slot: r.slot,
			instanceKey: instance,
			completionKey: r.completion_key,
			testXp: r.test_xp,
			state: "RESERVED_TEST_ONLY",
			expired: nowMs >= Date.parse(set.endsAt),
			sourceCapturedAt,
			recordedAt,
			fixtureKind: "SYNTHETIC_DEVNET",
			awardEligible: false,
		};
	});
	const receipts = checked.slice(0, limit),
		last = receipts.at(-1);
	return {
		campaignId: calendar.campaignId,
		passportId,
		fixtureKind: "SYNTHETIC_DEVNET",
		awardEligible: false,
		receipts,
		nextCursor:
			checked.length > limit
				? { startsAt: last.startsAt, slot: last.slot }
				: null,
	};
}
