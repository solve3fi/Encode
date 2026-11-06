import { PublicKey } from "@solana/web3.js";

export const GAUGE_STATUS = {
	created: 0,
	pendingActivation: 1,
	active: 2,
	pendingRemoval: 3,
	removed: 4,
} as const;

export const GAUGE_STATUS_LABEL: Record<number, string> = {
	0: "Not scheduled",
	1: "Pending activation",
	2: "Active",
	3: "Pending removal",
	4: "Removed",
};

/** Mints in the byte order the program uses for its canonical pair key. */
export function sortedMints(
	a: PublicKey,
	b: PublicKey,
): [PublicKey, PublicKey] {
	return Buffer.compare(a.toBuffer(), b.toBuffer()) <= 0 ? [a, b] : [b, a];
}

export function getPairPDA(
	programId: PublicKey,
	a: PublicKey,
	b: PublicKey,
): PublicKey {
	const [lo, hi] = sortedMints(a, b);
	return PublicKey.findProgramAddressSync(
		[Buffer.from("pair"), lo.toBuffer(), hi.toBuffer()],
		programId,
	)[0];
}

/** A scheduled change can be executed once the protocol reaches its epoch. */
export function isDue(effectiveEpoch: number, currentEpoch: number): boolean {
	return currentEpoch >= effectiveEpoch;
}

type PairGauge = {
	publicKey: PublicKey;
	account: {
		poolAddress: PublicKey;
		tokenMintA: PublicKey;
		tokenMintB: PublicKey;
		status: number;
	};
};

/**
 * The gauge that currently holds a token pair, if any. The program allows one canonical gauge per
 * pair: a gauge holds it while pending activation, active or pending removal. Scheduling a second
 * pool of the same pair is refused (`PairHasGauge`) until the holder is removed.
 */
export function pairHolderOf<T extends PairGauge>(
	gauges: readonly T[],
	mintA: PublicKey,
	mintB: PublicKey,
	exceptPool?: PublicKey,
): T | null {
	const [lo, hi] = sortedMints(mintA, mintB);
	const holds: number[] = [
		GAUGE_STATUS.pendingActivation,
		GAUGE_STATUS.active,
		GAUGE_STATUS.pendingRemoval,
	];
	return (
		gauges.find((gauge) => {
			if (!holds.includes(gauge.account.status)) return false;
			if (exceptPool?.equals(gauge.account.poolAddress)) return false;
			const [glo, ghi] = sortedMints(
				gauge.account.tokenMintA,
				gauge.account.tokenMintB,
			);
			return glo.equals(lo) && ghi.equals(hi);
		}) ?? null
	);
}
