// Pure TEST-ONLY LP qualification over stored position-value snapshots. It verifies claims it is given;
// it never reads the chain or chooses a price. A Passport qualifies for a featured pool during every
// interval in which the wallets linked to it at that moment hold positions in that pool worth at least
// the policy minimum. Position ownership follows the wallet of the latest event (no NFT-transfer
// evidence yet, so ownership coverage is transaction-only).
//
// Range-aware mode (policy.requireInRange): a position only counts while the pool's price is inside its tick
// range, because that is the only time it earns. The price comes from stored samples of the pool's current
// tick. Time is credited conservatively: an interval counts only when the sample at BOTH ends is inside the
// range, never more than policy.maxSampleGapSeconds of unobserved time is trusted after a sample, and a
// position whose range is unknown never counts. A stopped sampler therefore costs time, never grants it.

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CENTS = /^(0|[1-9][0-9]{0,37})$/;

export function validateLpPolicy(lp) {
	if (
		!lp ||
		!Array.isArray(lp.featuredPools) ||
		lp.featuredPools.length < 1 ||
		lp.featuredPools.length > 50 ||
		lp.featuredPools.some((p) => typeof p !== "string" || !WALLET.test(p)) ||
		new Set(lp.featuredPools).size !== lp.featuredPools.length ||
		typeof lp.minimumLpUsdCents !== "string" ||
		!CENTS.test(lp.minimumLpUsdCents) ||
		BigInt(lp.minimumLpUsdCents) === 0n ||
		[lp.valuationSource, lp.valuationVersion].some(
			(v) => typeof v !== "string" || !v.trim(),
		) ||
		!Number.isSafeInteger(lp.minimumDwellSeconds) ||
		lp.minimumDwellSeconds < 0 ||
		lp.minimumDwellSeconds > 604_800 ||
		(lp.requireInRange !== undefined && typeof lp.requireInRange !== "boolean") ||
		(lp.requireInRange === true &&
			(!Number.isSafeInteger(lp.maxSampleGapSeconds) ||
				lp.maxSampleGapSeconds < 30 ||
				lp.maxSampleGapSeconds > 3600))
	)
		throw new Error("LP qualification: explicit featured-pool policy required");
	return BigInt(lp.minimumLpUsdCents);
}

function ms(value, label) {
	if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000)
		throw new Error(`LP qualification: invalid ${label}`);
	return value;
}

/**
 * The intervals during which a range [lower, upper) held the pool's price, from time-ordered tick samples.
 * Conservative by construction (see the header): both ends of a stretch must be inside, and no more than
 * `maxGapMs` of unobserved time is trusted after any sample.
 */
export function rangeIntervals(samples, lower, upper, maxGapMs, capturedAtMs) {
	const inside = (tick) => lower <= tick && tick < upper;
	const out = [];
	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i];
		if (sample.tMs > capturedAtMs) break;
		if (!inside(sample.tick)) continue;
		const next = samples[i + 1] && samples[i + 1].tMs <= capturedAtMs ? samples[i + 1] : null;
		let end;
		if (next) {
			if (!inside(next.tick)) continue; // the price left somewhere in this stretch: credit none of it
			end = Math.min(next.tMs, sample.tMs + maxGapMs);
		} else {
			end = Math.min(capturedAtMs, sample.tMs + maxGapMs);
		}
		if (end <= sample.tMs) continue;
		const last = out.at(-1);
		if (last && last[1] === sample.tMs) last[1] = end;
		else out.push([sample.tMs, end]);
	}
	return out;
}

/**
 * @param events     liquidity events in the reconciled prefix: { eventId, kind, poolAddress, positionAddress,
 *                   tickLower, tickUpper } (the ticks are only used, and then required, in range-aware mode)
 * @param snapshots  lp_value_snapshots rows: { eventId, positionAddress, poolAddress, wallet,
 *                   effectiveMs, sequence, valueUsdCents, valuationSource, valuationVersion }
 * @param histories  [{ wallet, links: [{ passportId, linkedMs, unlinkedMs|null }] }]
 * @param tickSamples [{ poolAddress, tMs, tick }] stored pool tick samples (range-aware mode only)
 */
export function projectPassportLpQualification({
	events,
	snapshots,
	histories,
	policy,
	capturedAtMs,
	tickSamples,
	ownershipIntervals,
}) {
	const minimum = validateLpPolicy(policy);
	ms(capturedAtMs, "capture time");
	if (!Array.isArray(events) || !Array.isArray(snapshots) || !Array.isArray(histories))
		throw new Error("LP qualification: complete inputs required");
	const featured = new Set(policy.featuredPools);
	const owners = new Map();
	if (ownershipIntervals !== undefined) {
		if (!Array.isArray(ownershipIntervals)) throw new Error("LP qualification: ownership intervals required");
		for (const row of ownershipIntervals) {
			if (owners.has(row.positionAddress) || !Array.isArray(row.intervals))
				throw new Error("LP qualification: duplicate or malformed ownership position");
			let previousEnd = -1;
			for (const interval of row.intervals) {
				ms(interval.startMs, "ownership start"); ms(interval.endMs, "ownership end");
				if (interval.startMs < previousEnd || interval.endMs <= interval.startMs ||
					interval.endMs > capturedAtMs || (interval.wallet !== null && !WALLET.test(interval.wallet)))
					throw new Error("LP qualification: invalid ownership interval");
				previousEnd = interval.endMs;
			}
			owners.set(row.positionAddress, row.intervals);
		}
	}
	const rangeAware = policy.requireInRange === true;
	// position -> in-range intervals (range-aware mode only)
	const inRange = new Map();
	if (rangeAware) {
		if (!Array.isArray(tickSamples))
			throw new Error("LP qualification: tick samples required for range-aware mode");
		const maxGapMs = policy.maxSampleGapSeconds * 1000;
		const ranges = new Map();
		for (const event of events) {
			if (!featured.has(event.poolAddress)) continue;
			const { tickLower: lower, tickUpper: upper } = event;
			if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower >= upper)
				throw new Error("LP qualification: position range required");
			const known = ranges.get(event.positionAddress);
			if (known && (known.lower !== lower || known.upper !== upper || known.pool !== event.poolAddress))
				throw new Error("LP qualification: position range changed");
			ranges.set(event.positionAddress, { lower, upper, pool: event.poolAddress });
		}
		const byPool = new Map();
		for (const sample of tickSamples) {
			if (!featured.has(sample.poolAddress)) continue;
			ms(sample.tMs, "tick sample time");
			if (!Number.isInteger(sample.tick) || sample.tick < -443636 || sample.tick > 443636)
				throw new Error("LP qualification: invalid tick sample");
			if (!byPool.has(sample.poolAddress)) byPool.set(sample.poolAddress, []);
			byPool.get(sample.poolAddress).push(sample);
		}
		for (const list of byPool.values()) list.sort((a, b) => a.tMs - b.tMs);
		for (const [position, range] of ranges)
			inRange.set(
				position,
				rangeIntervals(byPool.get(range.pool) ?? [], range.lower, range.upper, maxGapMs, capturedAtMs),
			);
	}
	const covered = (position, t) =>
		(inRange.get(position) ?? []).some(([start, end]) => start <= t && t < end);

	// Every liquidity event of a featured pool must have exactly one matching snapshot.
	const byEvent = new Map();
	for (const s of snapshots) {
		if (
			s.valuationSource !== policy.valuationSource ||
			s.valuationVersion !== policy.valuationVersion ||
			byEvent.has(s.eventId) ||
			typeof s.valueUsdCents !== "string" ||
			!CENTS.test(s.valueUsdCents)
		)
			throw new Error("LP qualification: valuation pins differ or snapshot repeated");
		ms(s.effectiveMs, "snapshot time");
		if (s.effectiveMs > capturedAtMs)
			throw new Error("LP qualification: snapshot after capture");
		byEvent.set(s.eventId, s);
	}
	const timelines = new Map(); // pool -> position -> [{ t, seq, wallet, value }]
	for (const event of events) {
		if (!featured.has(event.poolAddress)) continue;
		const snapshot = byEvent.get(event.eventId);
		if (
			!snapshot ||
			snapshot.positionAddress !== event.positionAddress ||
			snapshot.poolAddress !== event.poolAddress
		)
			throw new Error("LP qualification: complete valuations required");
		if (!timelines.has(event.poolAddress)) timelines.set(event.poolAddress, new Map());
		const positions = timelines.get(event.poolAddress);
		if (!positions.has(event.positionAddress)) positions.set(event.positionAddress, []);
		positions.get(event.positionAddress).push({
			t: snapshot.effectiveMs,
			seq: Number(snapshot.sequence),
			wallet: snapshot.wallet,
			value: BigInt(snapshot.valueUsdCents),
		});
	}
	for (const positions of timelines.values())
		for (const list of positions.values())
			list.sort((a, b) => a.t - b.t || a.seq - b.seq);

	// Wallet -> link windows.
	const links = new Map();
	for (const history of histories) {
		for (const link of history.links) {
			const start = ms(link.linkedMs, "link start");
			const end = link.unlinkedMs === null ? Infinity : ms(link.unlinkedMs, "link end");
			if (end <= start) throw new Error("LP qualification: invalid link window");
			if (!links.has(history.wallet)) links.set(history.wallet, []);
			links.get(history.wallet).push({ passportId: link.passportId, start, end });
		}
	}

	const result = new Map(); // passport -> pool -> intervals
	for (const [pool, positions] of timelines) {
		const points = new Set();
		for (const list of positions.values()) for (const p of list) points.add(p.t);
		if (ownershipIntervals !== undefined)
			for (const position of positions.keys()) {
				if (!owners.has(position)) throw new Error("LP qualification: complete historical ownership required");
				for (const interval of owners.get(position)) {
					points.add(interval.startMs); points.add(interval.endMs);
				}
			}
		if (rangeAware)
			for (const position of positions.keys())
				for (const [start, end] of inRange.get(position) ?? []) {
					points.add(start);
					points.add(end);
				}
		for (const windows of links.values())
			for (const w of windows) {
				points.add(w.start);
				if (Number.isFinite(w.end)) points.add(w.end);
			}
		const times = [...points].filter((t) => t <= capturedAtMs).sort((a, b) => a - b);
		// Value of a wallet's positions in this pool at time t (latest snapshot at or before t).
		const valueAt = (t) => {
			const perWallet = new Map();
			for (const [position, list] of positions) {
				let latest;
				for (const p of list) if (p.t <= t) latest = p;
				const wallet = ownershipIntervals === undefined ? latest?.wallet :
					owners.get(position).find((i) => i.startMs <= t && t < i.endMs)?.wallet;
				if (wallet && latest && latest.value > 0n && (!rangeAware || covered(position, t)))
					perWallet.set(wallet, (perWallet.get(wallet) ?? 0n) + latest.value);
			}
			return perWallet;
		};
		const open = new Map(); // passport -> start of the current qualifying run
		const close = (passportId, end) => {
			const start = open.get(passportId);
			open.delete(passportId);
			if (end <= start) return;
			const byPool = result.get(passportId) ?? new Map();
			const intervals = byPool.get(pool) ?? [];
			intervals.push([start, end]);
			byPool.set(pool, intervals);
			result.set(passportId, byPool);
		};
		for (const t of times) {
			const perPassport = new Map();
			for (const [wallet, value] of valueAt(t)) {
				for (const w of links.get(wallet) ?? [])
					if (w.start <= t && t < w.end)
						perPassport.set(w.passportId, (perPassport.get(w.passportId) ?? 0n) + value);
			}
			const qualifying = new Set(
				[...perPassport].filter(([, v]) => v >= minimum).map(([id]) => id),
			);
			for (const id of [...open.keys()]) if (!qualifying.has(id)) close(id, t);
			for (const id of qualifying) if (!open.has(id)) open.set(id, t);
		}
		for (const id of [...open.keys()]) close(id, capturedAtMs);
	}

	const passports = [...result]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([passportId, byPool]) => ({
			passportId,
			pools: [...byPool]
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([poolAddress, intervals]) => ({
					poolAddress,
					// merge touching intervals (a run split only by an unrelated change point)
					intervals: intervals.reduce((merged, [start, end]) => {
						const last = merged.at(-1);
						if (last && last[1] === start) last[1] = end;
						else merged.push([start, end]);
						return merged;
					}, []),
				})),
		}));
	return {
		state: "SYNTHETIC_DEVNET_LP_QUALIFICATION",
		awardEligible: false,
		ownershipCoverage: ownershipIntervals === undefined ? "TRANSACTION_ONLY" : "HISTORICAL_COVERAGE",
		capturedAtMs,
		minimumLpUsdCents: policy.minimumLpUsdCents,
		// Anti-JIT: a pool only counts as joined after this much qualifying time inside the epoch.
		minimumDwellMs: policy.minimumDwellSeconds * 1000,
		featuredPools: [...policy.featuredPools].sort(),
		passports,
	};
}
