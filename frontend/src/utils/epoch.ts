export const EPOCH_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;

// ve(3,3) epochs roll at Thursday 00:00 UTC, which is Wednesday evening in
// North America (18:00 CST / 19:00 CDT).
export const getNextEpochBoundary = (now = Date.now()): number => {
	const date = new Date(now);
	const daysUntilThursday = (4 - date.getUTCDay() + 7) % 7;
	const boundary = Date.UTC(
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate() + daysUntilThursday,
	);

	return boundary > now ? boundary : boundary + EPOCH_LENGTH_MS;
};

export const INITIAL_WEEKLY_EMISSIONS = 1_300_000;
export const WEEKLY_EMISSIONS_DECAY = 0.02;
export const DEVELOPER_ALLOCATION = 0.04;

export const getWeeklyEmissions = (epoch: number): number =>
	INITIAL_WEEKLY_EMISSIONS * (1 - WEEKLY_EMISSIONS_DECAY) ** Math.max(0, epoch);

