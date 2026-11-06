import { PublicKey } from "@solana/web3.js";
import { assertPassportId } from "./passport-id.mjs";
import {
	calendarFail,
	calendarIso,
	verifyWeeklySet,
	WEEKLY_METRICS,
} from "./quest-calendar.mjs";

// A synthetic adapter only, not verification of raw browser events or chain data.
// Attribution, source qualification and completeness must be supplied by the
// checked backend evidence pipeline before a future live equivalent can award XP.
export function buildWeeklyQuestFacts({
	set,
	passportId,
	computedAt,
	evidence,
}) {
	set = verifyWeeklySet(set);
	assertPassportId(passportId);
	calendarIso(computedAt);
	const start = Date.parse(set.startsAt),
		end = Date.parse(set.endsAt),
		now = Date.parse(computedAt);
	if (now < start || now >= end)
		calendarFail("weekly facts require the active epoch");
	if (
		!evidence ||
		Object.keys(evidence).sort().join("|") !==
			"complete|events|fixtureKind|network" ||
		evidence.network !== "DEVNET" ||
		evidence.fixtureKind !== "SYNTHETIC_DEVNET" ||
		typeof evidence.complete !== "boolean" ||
		!Array.isArray(evidence.events) ||
		evidence.events.length > 20000
	)
		calendarFail("bounded synthetic evidence required");
	const seen = new Set(),
		days = new Set(),
		pools = new Set(),
		metrics = Object.fromEntries(
			WEEKLY_METRICS.map((k) => [k, evidence.complete ? 0 : null]),
		);
	for (const event of evidence.events) {
		if (
			!event ||
			Object.keys(event).sort().join("|") !==
				"kind|observedAt|passportId|poolAddress|qualified|sourceKey" ||
			![
				"SWAP",
				"FEATURED_POOL_JOIN",
				"TRADER_REFERRAL",
				"LP_REFERRAL",
			].includes(event.kind) ||
			typeof event.qualified !== "boolean" ||
			typeof event.sourceKey !== "string" ||
			!/^[a-zA-Z0-9:_-]{1,128}$/.test(event.sourceKey)
		)
			calendarFail("invalid synthetic event");
		assertPassportId(event.passportId);
		calendarIso(event.observedAt);
		if (seen.has(event.sourceKey))
			calendarFail("duplicate or conflicting event source");
		seen.add(event.sourceKey);
		if (event.kind === "FEATURED_POOL_JOIN") {
			try {
				if (
					typeof event.poolAddress !== "string" ||
					new PublicKey(event.poolAddress).toBase58() !== event.poolAddress
				)
					calendarFail("invalid featured pool");
			} catch {
				calendarFail("invalid featured pool");
			}
		} else if (event.poolAddress !== null)
			calendarFail("unexpected event pool");
		const time = Date.parse(event.observedAt);
		if (time > now) calendarFail("future evidence");
		if (
			!evidence.complete ||
			event.passportId !== passportId ||
			!event.qualified ||
			time < start ||
			time >= end
		)
			continue;
		if (event.kind === "SWAP") {
			metrics.qualifyingSwaps++;
			days.add(event.observedAt.slice(0, 10));
		}
		if (event.kind === "FEATURED_POOL_JOIN") pools.add(event.poolAddress);
		if (event.kind === "TRADER_REFERRAL") metrics.qualifiedTraderReferrals++;
		if (event.kind === "LP_REFERRAL") metrics.qualifiedLpReferrals++;
	}
	if (evidence.complete) {
		metrics.activeTradingDays = days.size;
		metrics.featuredPoolsJoined = pools.size;
	}
	return {
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		passportId,
		startsAt: set.startsAt,
		endsAt: set.endsAt,
		computedAt,
		metrics,
	};
}
