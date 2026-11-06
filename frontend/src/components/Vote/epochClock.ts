export type EpochClockState = "open" | "final-hour" | "settling" | "settled";

export const VOTE_CUTOFF_SECONDS = 5 * 60;

export function getEpochClockState(
	epochEndSeconds: number,
	chainNowSeconds: number,
	justSettled = false,
): EpochClockState {
	if (justSettled) return "settled";
	const cutoff = epochEndSeconds - VOTE_CUTOFF_SECONDS;
	if (chainNowSeconds >= epochEndSeconds) return "settling";
	if (chainNowSeconds >= cutoff) return "final-hour";
	return "open";
}
