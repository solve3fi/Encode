export type OptimizerGauge = {
	id: string;
	existingVotingPower: number;
	rewardValueUsd: number;
};

export type OptimizerAllocation = OptimizerGauge & {
	percent: number;
	allocatedVotingPower: number;
	estimatedRewardUsd: number;
};

const rewardForAllocation = (
	rewardValueUsd: number,
	existingVotingPower: number,
	allocatedVotingPower: number,
): number => {
	if (rewardValueUsd <= 0 || allocatedVotingPower <= 0) return 0;
	return (
		rewardValueUsd *
		(allocatedVotingPower / (existingVotingPower + allocatedVotingPower))
	);
};

/**
 * Allocates voting power in whole percentages. At each step it chooses the
 * gauge with the highest incremental voter reward. Each gauge's reward curve
 * is concave, so this discrete marginal allocation produces the optimum for
 * the percentages accepted by the on-chain vote instruction.
 */
export const optimizeVoteAllocation = (
	gauges: OptimizerGauge[],
	totalVotingPower: number,
): OptimizerAllocation[] => {
	const safePower = Math.max(0, totalVotingPower);
	const percentages = gauges.map(() => 0);

	if (gauges.length > 0 && safePower > 0) {
		const hasPricedRewards = gauges.some((gauge) => gauge.rewardValueUsd > 0);

		for (let point = 0; point < 100; point += 1) {
			if (!hasPricedRewards) {
				percentages[point % gauges.length] += 1;
				continue;
			}

			let bestIndex = 0;
			let bestGain = Number.NEGATIVE_INFINITY;

			for (let index = 0; index < gauges.length; index += 1) {
				const gauge = gauges[index];
				const beforePower = (safePower * percentages[index]) / 100;
				const afterPower = (safePower * (percentages[index] + 1)) / 100;
				const gain =
					rewardForAllocation(
						gauge.rewardValueUsd,
						Math.max(0, gauge.existingVotingPower),
						afterPower,
					) -
					rewardForAllocation(
						gauge.rewardValueUsd,
						Math.max(0, gauge.existingVotingPower),
						beforePower,
					);

				if (
					gain > bestGain + Number.EPSILON ||
					(Math.abs(gain - bestGain) <= Number.EPSILON &&
						percentages[index] < percentages[bestIndex])
				) {
					bestGain = gain;
					bestIndex = index;
				}
			}

			percentages[bestIndex] += 1;
		}
	}

	return gauges.map((gauge, index) => {
		const allocatedVotingPower = (safePower * percentages[index]) / 100;
		return {
			...gauge,
			percent: percentages[index],
			allocatedVotingPower,
			estimatedRewardUsd: rewardForAllocation(
				gauge.rewardValueUsd,
				Math.max(0, gauge.existingVotingPower),
				allocatedVotingPower,
			),
		};
	});
};
