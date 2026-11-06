import { assertPassportId } from "./passport-id.mjs";
import {
	calendarFail,
	calendarHash,
	calendarIso,
	calendarTime,
	previewWeeklyQuests,
	verifyWeeklySet,
	WEEKLY_METRICS,
} from "./quest-calendar.mjs";

const exact = (v, keys) => {
	if (
		!v ||
		Object.getPrototypeOf(v) !== Object.prototype ||
		Object.keys(v).sort().join("|") !== keys.split(" ").sort().join("|")
	)
		calendarFail("invalid XP preview schema");
};
function amount(v) {
	if (typeof v !== "string" || !/^[1-9][0-9]{0,14}$/.test(v))
		calendarFail("invalid test-only XP ceiling");
	return BigInt(v);
}
export function weeklyCompletionKey(campaignId, instanceKey, passportId) {
	assertPassportId(passportId);
	if (
		typeof campaignId !== "string" ||
		!/^[a-z0-9][a-z0-9-]{0,63}$/.test(campaignId) ||
		!/^[a-f0-9]{64}$/.test(instanceKey)
	)
		calendarFail("invalid weekly completion identity");
	return calendarHash([
		"weekly-completion",
		campaignId,
		instanceKey,
		passportId,
	]);
}

/** Test-only deterministic planning. Caller supplies complete prior plan history
 * from a trusted backend; this pure function never reserves budget or awards XP. */
export function previewWeeklyXp({ set, facts, nowMs, policy, priorPlans }) {
	set = verifyWeeklySet(set);
	calendarTime(nowMs);
	assertPassportId(facts?.passportId);
	exact(
		facts,
		"network fixtureKind passportId startsAt endsAt computedAt metrics",
	);
	exact(facts.metrics, WEEKLY_METRICS.join(" "));
	const computed = Date.parse(calendarIso(facts.computedAt));
	if (
		facts.network !== "DEVNET" ||
		facts.fixtureKind !== "SYNTHETIC_DEVNET" ||
		facts.startsAt !== set.startsAt ||
		facts.endsAt !== set.endsAt ||
		computed < Date.parse(set.startsAt) ||
		computed >= Date.parse(set.endsAt) ||
		computed > nowMs
	)
		calendarFail("period-scoped fixture facts required");
	for (const v of Object.values(facts.metrics))
		if (v !== null && (!Number.isSafeInteger(v) || v < 0 || v > 1000000))
			calendarFail("invalid period metric");
	exact(
		policy,
		"fixtureKind network revision perPassportEpochXp perCampaignEpochXp perCampaignYearXp",
	);
	if (
		policy.fixtureKind !== "SYNTHETIC_DEVNET" ||
		policy.network !== "DEVNET" ||
		!Number.isSafeInteger(policy.revision) ||
		policy.revision < 1 ||
		policy.revision > 10000
	)
		calendarFail("explicit test-only XP preview policy required");
	const personCap = amount(policy.perPassportEpochXp),
		epochCap = amount(policy.perCampaignEpochXp),
		yearCap = amount(policy.perCampaignYearXp);
	if (!Array.isArray(priorPlans) || priorPlans.length > 20000)
		calendarFail("complete bounded prior plan history required");
	const seen = new Set();
	let personUsed = 0n,
		epochUsed = 0n,
		yearUsed = 0n;
	for (const row of priorPlans) {
		exact(
			row,
			"campaignId startsAt slot passportId instanceKey testXp completionKey",
		);
		assertPassportId(row.passportId);
		calendarIso(row.startsAt);
		if (
			row.campaignId !== set.campaignId ||
			!Number.isSafeInteger(row.slot) ||
			row.slot < 0 ||
			row.slot > 2 ||
			!Number.isSafeInteger(row.testXp) ||
			row.testXp < 1 ||
			row.testXp > 1000000 ||
			Date.parse(row.startsAt) > nowMs ||
			new Date(row.startsAt).getUTCDay() !== 4 ||
			row.startsAt.slice(11) !== "00:00:00.000Z"
		)
			calendarFail("invalid prior plan scope");
		const instanceKey = calendarHash([
			"weekly",
			row.campaignId,
			row.startsAt,
			row.slot,
		]);
		if (
			row.instanceKey !== instanceKey ||
			row.completionKey !==
				weeklyCompletionKey(row.campaignId, instanceKey, row.passportId) ||
			seen.has(row.completionKey)
		)
			calendarFail("duplicate or rebound completion history");
		seen.add(row.completionKey);
		const xp = BigInt(row.testXp);
		yearUsed += xp;
		if (
			row.startsAt === set.startsAt &&
			row.testXp !== set.quests[row.slot].testXp
		)
			calendarFail("prior plan XP differs from active set");
		if (row.startsAt === set.startsAt) {
			epochUsed += xp;
			if (row.passportId === facts.passportId) personUsed += xp;
		}
	}
	if (personUsed > personCap || epochUsed > epochCap || yearUsed > yearCap)
		calendarFail("prior plans exceed reviewed test ceilings");
	const preview = previewWeeklyQuests({ set, nowMs, facts }),
		results = [];
	for (const q of set.quests) {
		const completionKey = weeklyCompletionKey(
				set.campaignId,
				q.instanceKey,
				facts.passportId,
			),
			xp = BigInt(q.testXp),
			status = preview.quests[q.slot].status;
		let state = status;
		if (seen.has(completionKey)) state = "ALREADY_PLANNED";
		else if (status === "PROVISIONAL_COMPLETE") {
			if (
				personUsed + xp > personCap ||
				epochUsed + xp > epochCap ||
				yearUsed + xp > yearCap
			)
				state = "TEST_CAP_EXHAUSTED";
			else {
				state = "PENDING_TEST_ONLY";
				personUsed += xp;
				epochUsed += xp;
				yearUsed += xp;
			}
		}
		results.push({
			instanceKey: q.instanceKey,
			completionKey,
			questId: q.id,
			slot: q.slot,
			state,
			testXp: q.testXp,
			awardEligible: false,
		});
	}
	return {
		fixtureKind: "SYNTHETIC_DEVNET",
		awardEligible: false,
		policyRevision: policy.revision,
		campaignId: set.campaignId,
		passportId: facts.passportId,
		startsAt: set.startsAt,
		expiresAt: set.endsAt,
		factsSha256: calendarHash(facts),
		setSha256: set.setSha256,
		results,
		usedTestXp: {
			passportEpoch: personUsed.toString(),
			campaignEpoch: epochUsed.toString(),
			campaignYear: yearUsed.toString(),
		},
	};
}
