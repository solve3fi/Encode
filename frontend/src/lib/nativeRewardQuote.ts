import {
	type CollectRewardsQuoteParam,
	collectRewardsQuote,
	type SolveData,
} from "@solve3fi/sdk";
import BN from "bn.js";

const GATE_MARKER = 0xa5;

/**
 * Mirrors `GateState::from_bytes` in the solve program: marker byte, open flag 0/1, bytes 18.. zero.
 * A gauge-managed pool keeps this record in slot 2, so slot 2 is not empty for a managed pool.
 */
function isGateRecord(bytes: Uint8Array): boolean {
	return (
		bytes.length === 32 &&
		bytes[0] === GATE_MARKER &&
		bytes[1] <= 1 &&
		bytes.slice(18).every((byte) => byte === 0)
	);
}

/** SDK 0.3.x calls these bytes `authority`; on-chain they are extensions. */
export function nativeRewardEnd(pool: SolveData): BN | null {
	const primary = pool.rewardInfos[1]?.authority?.toBytes();
	const secondary = pool.rewardInfos[2]?.authority?.toBytes();
	if (
		!primary ||
		!secondary ||
		!isGateRecord(secondary) ||
		(primary[0] & 2) === 0
	)
		return null;
	return new BN(primary.slice(2, 10), "le");
}

export function collectRangeRewardsQuote(params: CollectRewardsQuoteParam) {
	const now = BN.max(
		params.solve.rewardLastUpdatedTimestamp,
		params.timeStampInSeconds ?? new BN(Math.floor(Date.now() / 1000)),
	);
	const quote = collectRewardsQuote({ ...params, timeStampInSeconds: now });
	const end = nativeRewardEnd(params.solve);
	if (!end) return quote;
	// Only slot 0 has the gauge deadline. Other reward tokens keep their own
	// normal accrual; never cap all three slots to the gauge's epoch boundary.
	const capped = BN.max(
		params.solve.rewardLastUpdatedTimestamp,
		BN.min(now, end),
	);
	const nativeQuote = collectRewardsQuote({
		...params,
		timeStampInSeconds: capped,
	});
	quote.rewardOwed[0] = nativeQuote.rewardOwed[0];
	quote.transferFee.deductedFromRewardOwed[0] =
		nativeQuote.transferFee.deductedFromRewardOwed[0];
	return quote;
}
