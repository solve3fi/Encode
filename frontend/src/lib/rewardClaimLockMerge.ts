import type BN from "bn.js";

export type MergeCandidate = { identifier: BN; tokenAmount: BN };

/** Keep the largest veNFT; break ties by retaining the older (lower) ID. */
export function highestVeNft<T extends MergeCandidate>(
	locks: T[],
): T | undefined {
	return locks.reduce<T | undefined>((best, lock) => {
		if (!best) return lock;
		const amountOrder = lock.tokenAmount.cmp(best.tokenAmount);
		if (amountOrder > 0) return lock;
		if (amountOrder === 0 && lock.identifier.lt(best.identifier)) return lock;
		return best;
	}, undefined);
}

/** Never lock pre-existing wallet funds or more than the quoted claim amount. */
export function claimedSolv3ToLock(
	before: bigint,
	after: bigint,
	quoted: bigint,
): bigint {
	if (after <= before || quoted <= BigInt(0)) return BigInt(0);
	const received = after - before;
	return received < quoted ? received : quoted;
}

export function formatSolv3(raw: bigint): string {
	const whole = raw / BigInt(1_000_000_000);
	const fraction = (raw % BigInt(1_000_000_000))
		.toString()
		.padStart(9, "0")
		.replace(/0+$/, "");
	return fraction ? `${whole}.${fraction}` : whole.toString();
}
