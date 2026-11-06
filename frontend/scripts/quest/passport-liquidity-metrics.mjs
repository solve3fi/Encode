import { isDeepStrictEqual } from "node:util";
import { passportAtEvent } from "./wallet-link-attribution.mjs";

const MAX_SECONDS = 8_640_000_000_000;
function seconds(value) {
	if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SECONDS)
		throw new Error("LP metrics: invalid interval time");
	return value;
}
function amount(value) {
	if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,37})$/.test(value))
		throw new Error("LP metrics: invalid USD cents");
	return BigInt(value);
}
function linkMs(value) {
	const ms = Date.parse(value);
	if (
		typeof value !== "string" ||
		!Number.isSafeInteger(ms) ||
		ms < 0 ||
		new Date(ms).toISOString() !== value
	) {
		throw new Error(
			"LP metrics: canonical millisecond wallet history required",
		);
	}
	return ms;
}

/** Pure synthetic interval experiment. Verifies claims, never chain or prices. */
export function projectPassportLiquidityMetrics({
	snapshot,
	policy,
	positions,
	histories,
}) {
	if (
		snapshot?.network !== "DEVNET" ||
		snapshot.fixtureKind !== "SYNTHETIC_DEVNET" ||
		typeof snapshot.campaignId !== "string" ||
		!snapshot.campaignId.trim() ||
		policy?.network !== "DEVNET" ||
		policy.fixtureKind !== "SYNTHETIC_DEVNET" ||
		!Number.isSafeInteger(policy.revision) ||
		policy.revision < 1 ||
		[policy.valuationSource, policy.valuationVersion].some(
			(v) => typeof v !== "string" || !v.trim(),
		) ||
		!Number.isSafeInteger(policy.maximumPriceAgeSeconds) ||
		policy.maximumPriceAgeSeconds < 0 ||
		!Array.isArray(policy.featuredPools) ||
		policy.featuredPools.some((p) => typeof p !== "string" || !p.trim()) ||
		new Set(policy.featuredPools).size !== policy.featuredPools.length ||
		!Array.isArray(positions) ||
		positions.length > 2000 ||
		!Array.isArray(histories) ||
		histories.length > 20_000
	) {
		throw new Error(
			"LP metrics: bounded synthetic Devnet input and policy required",
		);
	}
	for (const key of [
		"startSlot",
		"computedThroughSlot",
		"nextSlot",
		"reconciledThroughSlot",
	]) {
		if (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0)
			throw new Error("LP metrics: invalid source slot");
	}
	if (
		snapshot.startSlot > snapshot.computedThroughSlot ||
		snapshot.nextSlot <= snapshot.computedThroughSlot ||
		snapshot.reconciledThroughSlot < snapshot.computedThroughSlot ||
		snapshot.reconciledThroughSlot >= snapshot.nextSlot
	) {
		throw new Error("LP metrics: unreconciled source claims");
	}
	const start = seconds(snapshot.startsAtSeconds),
		end = seconds(snapshot.endsAtSeconds);
	if (end <= start) throw new Error("LP metrics: invalid campaign window");
	const minimum = amount(policy.minimumPoolUsdCents);
	if (minimum === 0n)
		throw new Error("LP metrics: positive pool minimum required");
	const historyByWallet = new Map();
	for (const history of histories) {
		if (!history || historyByWallet.has(history.wallet))
			throw new Error("LP metrics: duplicate wallet history");
		passportAtEvent({
			network: "DEVNET",
			wallet: history.wallet,
			eventAt: new Date(start * 1000).toISOString(),
			links: history.links,
		});
		for (const link of history.links) {
			linkMs(link.linkedAt);
			if (link.unlinkedAt !== null) linkMs(link.unlinkedAt);
		}
		historyByWallet.set(history.wallet, history.links);
	}
	const seenPositions = new Set(),
		seenEvidence = new Map(),
		changesByPassport = new Map();
	let intervalCount = 0;
	function change(passportId, pool, ms, delta) {
		if (!changesByPassport.has(passportId))
			changesByPassport.set(passportId, new Map());
		const changes = changesByPassport.get(passportId);
		if (!changes.has(ms)) changes.set(ms, new Map());
		const pools = changes.get(ms);
		pools.set(pool, (pools.get(pool) ?? 0n) + delta);
	}
	for (const position of positions) {
		if (
			!position ||
			typeof position.positionAddress !== "string" ||
			!position.positionAddress.trim() ||
			seenPositions.has(position.positionAddress) ||
			typeof position.poolAddress !== "string" ||
			!position.poolAddress.trim() ||
			!Array.isArray(position.intervals) ||
			position.intervals.length === 0
		)
			throw new Error("LP metrics: invalid or repeated position");
		seenPositions.add(position.positionAddress);
		const unique = new Map();
		for (const interval of position.intervals) {
			if (++intervalCount > 20_000)
				throw new Error("LP metrics: oversized interval snapshot");
			if (
				!interval ||
				typeof interval.sourceKey !== "string" ||
				!interval.sourceKey.trim() ||
				interval.finality !== "finalized"
			) {
				throw new Error("LP metrics: finalized identified interval required");
			}
			const evidence = {
				positionAddress: position.positionAddress,
				poolAddress: position.poolAddress,
				interval,
			};
			const previous = seenEvidence.get(interval.sourceKey);
			if (previous && !isDeepStrictEqual(previous, evidence))
				throw new Error("LP metrics: conflicting interval replay");
			seenEvidence.set(interval.sourceKey, evidence);
			unique.set(interval.sourceKey, interval);
		}
		let cursor = start;
		for (const interval of [...unique.values()].sort(
			(a, b) => a.startsAtSeconds - b.startsAtSeconds,
		)) {
			const from = seconds(interval.startsAtSeconds),
				to = seconds(interval.endsAtSeconds);
			if (from !== cursor || to <= from || to > end)
				throw new Error(
					"LP metrics: incomplete or overlapping position history",
				);
			cursor = to;
			const value = amount(interval.valueUsdCents);
			if (interval.wallet !== null && !historyByWallet.has(interval.wallet))
				throw new Error("LP metrics: explicit wallet history missing");
			if (value === 0n) continue;
			if (interval.wallet === null)
				throw new Error("LP metrics: valued position owner missing");
			if (
				interval.valuationSource !== policy.valuationSource ||
				interval.valuationVersion !== policy.valuationVersion ||
				!Number.isSafeInteger(interval.priceObservedAtSeconds) ||
				interval.priceObservedAtSeconds < 0 ||
				interval.priceObservedAtSeconds > from ||
				to - interval.priceObservedAtSeconds > policy.maximumPriceAgeSeconds
			) {
				throw new Error(
					"LP metrics: stale price coverage or valuation pins differ",
				);
			}
			if (!policy.featuredPools.includes(position.poolAddress)) continue;
			for (const link of historyByWallet.get(interval.wallet)) {
				const left = Math.max(from * 1000, linkMs(link.linkedAt));
				const right = Math.min(
					to * 1000,
					link.unlinkedAt === null ? end * 1000 : linkMs(link.unlinkedAt),
				);
				if (right <= left) continue;
				change(link.passportId, position.poolAddress, left, value);
				change(link.passportId, position.poolAddress, right, -value);
			}
		}
		if (cursor !== end)
			throw new Error("LP metrics: incomplete position history at end");
	}
	const passports = [];
	for (const [passportId, changes] of [...changesByPassport].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	)) {
		const points = [...changes.keys()].sort((a, b) => a - b),
			pools = new Map(),
			joined = new Set();
		let duration = 0n,
			weighted = 0n,
			streak = 0n,
			longest = 0n;
		for (let index = 0; index < points.length; index++) {
			for (const [pool, delta] of changes.get(points[index])) {
				pools.set(pool, (pools.get(pool) ?? 0n) + delta);
				if (pools.get(pool) < 0n)
					throw new Error("LP metrics: negative aggregate value");
			}
			if (index === points.length - 1) break;
			const ms = BigInt(points[index + 1] - points[index]);
			let eligible = 0n;
			for (const [pool, value] of pools)
				if (value >= minimum) {
					eligible += value;
					joined.add(pool);
				}
			if (eligible === 0n) {
				streak = 0n;
				continue;
			}
			duration += ms;
			weighted += eligible * ms;
			streak += ms;
			if (streak > longest) longest = streak;
		}
		passports.push({
			passportId,
			qualifyingMilliseconds: duration.toString(),
			usdCentMilliseconds: weighted.toString(),
			longestFeaturedLpStreakMilliseconds: longest.toString(),
			longestFeaturedLpStreakDays: Number(longest / 86_400_000n),
			featuredPoolsJoined: joined.size,
			featuredPools: [...joined].sort(),
		});
	}
	return {
		state: "SYNTHETIC_DEVNET_LP_METRICS",
		network: "DEVNET",
		awardEligible: false,
		campaignId: snapshot.campaignId,
		computedThroughSlot: snapshot.computedThroughSlot,
		policyRevision: policy.revision,
		passports,
	};
}
