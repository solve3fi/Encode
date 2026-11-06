// Accelerator Program matching, shared by the keeper. The formula mirrors the admin UI
// (src/components/Admin/AdminAcceleratorProgram.tsx) exactly: a partner pool holding at least
// 2% of all votes is matched by the same share (capped at 10%), cast by the accelerator wallet's
// own veSOLV3, scaled down together when the wallet has less power than the total desired match.
export const ELIGIBILITY_THRESHOLD_PCT = 2;
export const MAX_MATCH_PCT = 10;
export const DEFAULT_MAX_EPOCHS = 4;
export const GAUGE_ACTIVE = 2;

const toUnits = (power) => Number(power) / 1e9;

/**
 * partners: [{ poolAddress, status, enrolledAtEpoch, maxEpochs }] (active ones are matched)
 * weightUnitsForPool: (poolAddress) => this epoch's gauge vote weight in token units
 * Returns one row per active partner with its suggested percent of the accelerator wallet's vote.
 */
export function computeMatches({
	partners,
	currentEpoch,
	totalVotingPowerUnits,
	acceleratorPowerUnits,
	weightUnitsForPool,
}) {
	if (!(totalVotingPowerUnits > 0)) return [];
	const acceleratorPct = (acceleratorPowerUnits / totalVotingPowerUnits) * 100;
	const rows = partners
		.filter((partner) => partner.status === "active")
		.map((partner) => {
			const sharePct = (weightUnitsForPool(partner.poolAddress) / totalVotingPowerUnits) * 100;
			const eligible = sharePct >= ELIGIBILITY_THRESHOLD_PCT;
			const epochsElapsed = Math.max(0, currentEpoch - partner.enrolledAtEpoch);
			return {
				poolAddress: partner.poolAddress,
				sharePct,
				eligible,
				desiredMatchPct: eligible ? Math.min(sharePct, MAX_MATCH_PCT) : 0,
				epochsRemaining: Math.max(0, partner.maxEpochs - epochsElapsed),
			};
		});
	const totalDesired = rows.reduce((sum, row) => sum + row.desiredMatchPct, 0);
	const scale = totalDesired > acceleratorPct && totalDesired > 0 ? acceleratorPct / totalDesired : 1;
	return rows.map((row) => {
		const finalMatch = row.desiredMatchPct * scale;
		const suggestedWalletPct =
			acceleratorPct > 0
				? Math.max(0, Math.min(100, Math.round((finalMatch / acceleratorPct) * 100)))
				: 0;
		return { ...row, suggestedWalletPct };
	});
}

/** Turns match rows into a vote allocation whose percentages never add up to more than 100. */
export function toAllocation(matches) {
	const pools = matches
		.filter((match) => match.suggestedWalletPct > 0)
		.map((match) => ({ poolAddress: match.poolAddress, percent: match.suggestedWalletPct }));
	let total = pools.reduce((sum, pool) => sum + pool.percent, 0);
	while (total > 100) {
		const largest = pools.reduce((best, pool) => (pool.percent > best.percent ? pool : best), pools[0]);
		largest.percent -= 1;
		total -= 1;
	}
	return pools.filter((pool) => pool.percent > 0);
}

/** Partners whose program window is over become completed. Returns the pool addresses to complete. */
export function expiredPartners(partners, currentEpoch) {
	return partners
		.filter(
			(partner) =>
				partner.status === "active" &&
				currentEpoch - partner.enrolledAtEpoch >= partner.maxEpochs,
		)
		.map((partner) => partner.poolAddress);
}

/**
 * Applications that asked for the Accelerator Program and whose token now trades in a pool with an
 * ACTIVE gauge. An application alone never earns a match: a gauge only goes active after an admin
 * adds and activates it, and that is the vetting step.
 * applications: [{ project, mint, accelerator }]
 * gauges: [{ poolAddress, tokenMintA, tokenMintB, status, weightUnits }]
 * knownPools: Set of pool addresses that already have a partner record of any status
 */
export function findEnrollments({ applications, gauges, knownPools, currentEpoch, now = Date.now() }) {
	const claimed = new Set(knownPools);
	const enrollments = [];
	for (const application of applications) {
		if (application.accelerator !== true || !application.mint) continue;
		const candidates = gauges
			.filter(
				(gauge) =>
					gauge.status === GAUGE_ACTIVE &&
					(gauge.tokenMintA === application.mint || gauge.tokenMintB === application.mint) &&
					!claimed.has(gauge.poolAddress),
			)
			.sort((a, b) => b.weightUnits - a.weightUnits);
		const pick = candidates[0];
		if (!pick) continue;
		claimed.add(pick.poolAddress);
		enrollments.push({
			poolAddress: pick.poolAddress,
			projectName: application.project,
			enrolledAtEpoch: currentEpoch,
			maxEpochs: DEFAULT_MAX_EPOCHS,
			status: "active",
			notes: "Auto-enrolled from an Accelerator partner application with an active gauge",
			addedBy: "accelerator-keeper",
			addedAt: now,
			updatedAt: now,
		});
	}
	return enrollments;
}

export { toUnits };
