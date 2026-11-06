import { isDeepStrictEqual } from "node:util";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { projectPassportSwapEvidence } from "./passport-source-evidence.mjs";

function amount(value) {
	if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,37})$/.test(value))
		throw new Error("Swap qualification: invalid USD cents");
	return BigInt(value);
}

export function validateSwapQualificationPolicy(policy) {
	if (
		policy?.fixtureKind !== "SYNTHETIC_DEVNET" ||
		policy.network !== "DEVNET" ||
		!Number.isSafeInteger(policy.revision) ||
		policy.revision < 1 ||
		[policy.valuationSource, policy.valuationVersion].some(
			(v) => typeof v !== "string" || !v.trim(),
		) ||
		!Number.isSafeInteger(policy.maximumPriceAgeSeconds) ||
		policy.maximumPriceAgeSeconds < 0
	)
		throw new Error(
			"Swap qualification: explicit synthetic Devnet policy required",
		);
	const minimum = amount(policy.minimumSwapUsdCents);
	if (minimum === 0n)
		throw new Error("Swap qualification: positive minimum required");
	return minimum;
}

/** Pure synthetic Devnet policy experiment, never an award or price verifier. */
export function projectPassportSwapQualification({
	snapshot,
	policy,
	valuations,
}) {
	const minimum = validateSwapQualificationPolicy(policy);
	if (!Array.isArray(valuations))
		throw new Error("Swap qualification: complete valuations required");
	// Validate the entire event/history snapshot and globally dedupe before any
	// Passport or campaign-time filtering. This does not verify the chain itself.
	const sourceEvidence = projectPassportSwapEvidence(snapshot);
	const events = new Map(
		snapshot.events.map((event) => [
			JSON.stringify(fingerprintGenesisEvent(event.record).identity),
			event,
		]),
	);
	const valued = new Map();
	for (const valuation of valuations) {
		const event = events.get(valuation?.sourceKey);
		if (
			!event ||
			valuation.eventSha256 !== event.eventSha256 ||
			valuation.valuationSource !== policy.valuationSource ||
			valuation.valuationVersion !== policy.valuationVersion
		)
			throw new Error("Swap qualification: valuation source pins differ");
		amount(valuation.valueUsdCents);
		if (
			!Number.isSafeInteger(valuation.priceObservedAtSeconds) ||
			valuation.priceObservedAtSeconds < 0 ||
			valuation.priceObservedAtSeconds > event.record.blockTimeSeconds ||
			event.record.blockTimeSeconds - valuation.priceObservedAtSeconds >
				policy.maximumPriceAgeSeconds
		) {
			throw new Error(
				"Swap qualification: missing, future or stale price time",
			);
		}
		if (
			!valuation.priceEvidence ||
			Object.getPrototypeOf(valuation.priceEvidence) !== Object.prototype ||
			Object.keys(valuation.priceEvidence).length === 0
		)
			throw new Error("Swap qualification: price evidence required");
		// Reuse the canonical JSON validator; an evidence hash is not oracle proof.
		fingerprintGenesisEvent({
			...event.record,
			payload: valuation.priceEvidence,
		});
		const normalized = {
			sourceKey: valuation.sourceKey,
			eventSha256: valuation.eventSha256,
			valueUsdCents: valuation.valueUsdCents,
			priceObservedAtSeconds: valuation.priceObservedAtSeconds,
			valuationSource: valuation.valuationSource,
			valuationVersion: valuation.valuationVersion,
			priceEvidence: valuation.priceEvidence,
		};
		const previous = valued.get(valuation.sourceKey);
		if (previous && !isDeepStrictEqual(previous, normalized))
			throw new Error("Swap qualification: conflicting valuation replay");
		valued.set(valuation.sourceKey, normalized);
	}
	if (valued.size !== events.size)
		throw new Error("Swap qualification: complete valuations required");
	const routes = new Map();
	for (const [sourceKey, event] of events) {
		const r = event.record;
		const kind = r.payload.instructionKind;
		if (!["swap", "swap_v2", "two_hop_swap", "two_hop_swap_v2"].includes(kind))
			throw new Error("Swap qualification: unsupported instruction kind");
		const actionKey = JSON.stringify([
			r.campaignId,
			r.cluster,
			r.signature,
			r.instructionIndex,
		]);
		if (!routes.has(actionKey)) routes.set(actionKey, []);
		routes.get(actionKey).push({ sourceKey, event });
	}
	const ownerBySource = new Map(
		sourceEvidence.passports.flatMap((p) =>
			p.sources.map((s) => [s.sourceKey, p.passportId]),
		),
	);
	const passports = new Map(
		sourceEvidence.passports.map((p) => [
			p.passportId,
			{ passportId: p.passportId, actions: [], days: new Set() },
		]),
	);
	for (const [actionKey, legs] of [...routes].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)) {
		legs.sort((a, b) => a.event.record.eventIndex - b.event.record.eventIndex);
		const first = legs[0].event.record;
		const expectedLegs = first.payload.instructionKind.startsWith(
			"two_hop_swap",
		)
			? 2
			: 1;
		if (
			legs.length !== expectedLegs ||
			legs.some(
				({ event }, index) =>
					event.record.eventIndex !== index ||
					event.record.payload.instructionKind !==
						first.payload.instructionKind ||
					event.record.wallet !== first.wallet ||
					event.record.slot !== first.slot ||
					event.record.blockTimeSeconds !== first.blockTimeSeconds,
			)
		) {
			throw new Error("Swap qualification: incomplete or inconsistent route");
		}
		const owner = ownerBySource.get(legs[0].sourceKey);
		if (legs.some((leg) => ownerBySource.get(leg.sourceKey) !== owner))
			throw new Error("Swap qualification: route attribution differs");
		// Conservative experiment: use the smaller leg value, never sum routed
		// legs. Live policy and authoritative valuation still need human review.
		const values = legs.map((leg) =>
			amount(valued.get(leg.sourceKey).valueUsdCents),
		);
		const value = values.reduce((a, b) => (a < b ? a : b));
		if (!owner || value < minimum) continue;
		const row = passports.get(owner);
		row.days.add(Math.floor(first.blockTimeSeconds / 86400));
		row.actions.push({
			actionKey,
			sourceKeys: legs.map((leg) => leg.sourceKey),
			poolAddresses: legs.map((leg) => leg.event.record.poolAddress),
			valueUsdCents: value.toString(),
			occurredAtSeconds: first.blockTimeSeconds,
		});
	}
	return {
		state: "SYNTHETIC_DEVNET_SWAP_QUALIFICATION",
		awardEligible: false,
		network: "DEVNET",
		campaignId: sourceEvidence.campaignId,
		decoderVersion: sourceEvidence.decoderVersion,
		computedThroughSlot: sourceEvidence.computedThroughSlot,
		policyRevision: policy.revision,
		passports: [...passports.values()].map((row) => ({
			passportId: row.passportId,
			qualifyingSwaps: row.actions.length,
			activeUtcDayIndices: [...row.days].sort((a, b) => a - b),
			actions: row.actions,
		})),
	};
}
