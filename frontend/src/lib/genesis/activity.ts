/**
 * Deterministic campaign calculations over records supplied by a trusted indexer.
 * This module does not verify a chain transaction or award XP / SOLV3.
 */

export type IndexedSwap = {
	/** Unique across signature, instruction and inner-event index. */
	eventKey: string;
	wallet: string;
	finality: "finalized";
	occurredAtSeconds: number;
	qualifyingVolumeUsdCents: bigint;
};

export type TradingActivity = {
	qualifyingSwaps: number;
	activeUtcDayIndices: number[];
};

const assertTimestamp = (seconds: number) => {
	if (!Number.isSafeInteger(seconds) || seconds < 0) {
		throw new RangeError("Event timestamps must be non-negative Unix seconds.");
	}
};

export function summarizeTradingActivity(
	events: readonly IndexedSwap[],
	wallet: string,
	minimumSwapUsdCents: bigint,
): TradingActivity {
	if (minimumSwapUsdCents < BigInt(0)) {
		throw new RangeError("Minimum swap value cannot be negative.");
	}
	const seen = new Map<string, IndexedSwap>();
	const activeDays = new Set<number>();
	let qualifyingSwaps = 0;

	for (const event of events) {
		if (!event.eventKey || !event.wallet || event.finality !== "finalized") {
			throw new Error("Only identified, finalized swaps can be summarized.");
		}
		assertTimestamp(event.occurredAtSeconds);
		if (event.qualifyingVolumeUsdCents < BigInt(0)) {
			throw new RangeError("Swap value cannot be negative.");
		}
		const previous = seen.get(event.eventKey);
		if (previous) {
			if (
				previous.wallet !== event.wallet ||
				previous.occurredAtSeconds !== event.occurredAtSeconds ||
				previous.qualifyingVolumeUsdCents !== event.qualifyingVolumeUsdCents
			) {
				throw new Error(`Conflicting swap event: ${event.eventKey}`);
			}
			continue;
		}
		seen.set(event.eventKey, event);
		if (
			event.wallet !== wallet ||
			event.qualifyingVolumeUsdCents < minimumSwapUsdCents
		) {
			continue;
		}
		qualifyingSwaps += 1;
		activeDays.add(Math.floor(event.occurredAtSeconds / 86_400));
	}

	return {
		qualifyingSwaps,
		activeUtcDayIndices: [...activeDays].sort((a, b) => a - b),
	};
}

export type LiquidityValueSnapshot = {
	/** Unique event or oracle valuation snapshot key. */
	eventKey: string;
	/** Canonical ordering within one second. */
	sequence: bigint;
	atSeconds: number;
	/** Position value after this event, using an authoritative USD source. */
	usdCents: bigint;
};

function assertLiquidityInterval(
	startSeconds: number,
	endSeconds: number,
	minimumQualifyingUsdCents: bigint,
) {
	assertTimestamp(startSeconds);
	assertTimestamp(endSeconds);
	if (endSeconds <= startSeconds || minimumQualifyingUsdCents < BigInt(0)) {
		throw new RangeError("Invalid liquidity accounting interval or threshold.");
	}
}

function orderedLiquiditySnapshots(
	snapshots: readonly LiquidityValueSnapshot[],
) {
	const seen = new Map<string, LiquidityValueSnapshot>();
	for (const snapshot of snapshots) {
		if (
			!snapshot.eventKey ||
			snapshot.usdCents < BigInt(0) ||
			snapshot.sequence < BigInt(0)
		) {
			throw new Error("Invalid liquidity snapshot.");
		}
		assertTimestamp(snapshot.atSeconds);
		const previous = seen.get(snapshot.eventKey);
		if (previous) {
			if (
				previous.atSeconds !== snapshot.atSeconds ||
				previous.sequence !== snapshot.sequence ||
				previous.usdCents !== snapshot.usdCents
			) {
				throw new Error(`Conflicting liquidity snapshot: ${snapshot.eventKey}`);
			}
			continue;
		}
		seen.set(snapshot.eventKey, snapshot);
	}
	const ordered = [...seen.values()].sort(
		(a, b) =>
			a.atSeconds - b.atSeconds ||
			(a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0),
	);
	for (let index = 1; index < ordered.length; index += 1) {
		const previous = ordered[index - 1];
		const current = ordered[index];
		if (
			previous.atSeconds === current.atSeconds &&
			previous.sequence === current.sequence
		) {
			throw new Error("Liquidity snapshots have conflicting event order.");
		}
	}
	return ordered;
}

/**
 * Integrate one position's qualifying USD value over [start, end).
 * Callers must supply a snapshot at or before start and at every change in
 * position size or valuation; a final balance snapshot is insufficient.
 */
export function summarizeLiquidityParticipation(
	snapshots: readonly LiquidityValueSnapshot[],
	startSeconds: number,
	endSeconds: number,
	minimumQualifyingUsdCents: bigint,
): { qualifyingSeconds: bigint; usdCentSeconds: bigint } {
	assertLiquidityInterval(startSeconds, endSeconds, minimumQualifyingUsdCents);
	const ordered = orderedLiquiditySnapshots(snapshots);
	const initial = [...ordered]
		.reverse()
		.find((item) => item.atSeconds <= startSeconds);
	if (!initial) {
		throw new Error(
			"A liquidity snapshot at or before the interval start is required.",
		);
	}

	let currentValue = initial.usdCents;
	let cursor = startSeconds;
	let total = BigInt(0);
	let qualifyingSeconds = BigInt(0);
	for (const snapshot of ordered) {
		if (snapshot.atSeconds <= startSeconds) continue;
		if (snapshot.atSeconds >= endSeconds) break;
		if (currentValue > BigInt(0) && currentValue >= minimumQualifyingUsdCents) {
			const seconds = BigInt(snapshot.atSeconds - cursor);
			qualifyingSeconds += seconds;
			total += currentValue * seconds;
		}
		cursor = snapshot.atSeconds;
		currentValue = snapshot.usdCents;
	}
	if (currentValue > BigInt(0) && currentValue >= minimumQualifyingUsdCents) {
		const seconds = BigInt(endSeconds - cursor);
		qualifyingSeconds += seconds;
		total += currentValue * seconds;
	}
	return { qualifyingSeconds, usdCentSeconds: total };
}

export type WalletPositionValueSeries = {
	positionAddress: string;
	/** Value for this wallet after each ownership, size or valuation change. */
	snapshots: readonly LiquidityValueSnapshot[];
};

/**
 * Count wallet LP time once even when several positions overlap. The source
 * must provide a zero-value baseline for positions opened after start and a
 * zero-value change when ownership leaves this wallet.
 */
export function summarizeWalletLiquidityParticipation(
	positions: readonly WalletPositionValueSeries[],
	startSeconds: number,
	endSeconds: number,
	minimumWalletUsdCents: bigint,
): { qualifyingSeconds: bigint; usdCentSeconds: bigint } {
	assertLiquidityInterval(startSeconds, endSeconds, minimumWalletUsdCents);
	const values = new Map<string, bigint>();
	const snapshotKeys = new Set<string>();
	const changes: {
		positionAddress: string;
		snapshot: LiquidityValueSnapshot;
	}[] = [];
	let walletValue = BigInt(0);
	for (const position of positions) {
		if (!position.positionAddress || values.has(position.positionAddress))
			throw new Error("Invalid or repeated wallet LP position.");
		const ordered = orderedLiquiditySnapshots(position.snapshots);
		for (const snapshot of ordered) {
			if (snapshotKeys.has(snapshot.eventKey))
				throw new Error("Repeated wallet LP snapshot key across positions.");
			snapshotKeys.add(snapshot.eventKey);
			if (snapshot.atSeconds > startSeconds && snapshot.atSeconds < endSeconds)
				changes.push({ positionAddress: position.positionAddress, snapshot });
		}
		const initial = [...ordered]
			.reverse()
			.find((item) => item.atSeconds <= startSeconds);
		if (!initial)
			throw new Error(
				"A wallet LP position needs a value at or before interval start.",
			);
		values.set(position.positionAddress, initial.usdCents);
		walletValue += initial.usdCents;
	}
	changes.sort(
		(a, b) =>
			a.snapshot.atSeconds - b.snapshot.atSeconds ||
			a.positionAddress.localeCompare(b.positionAddress) ||
			(a.snapshot.sequence < b.snapshot.sequence
				? -1
				: a.snapshot.sequence > b.snapshot.sequence
					? 1
					: 0),
	);
	let cursor = startSeconds;
	let qualifyingSeconds = BigInt(0);
	let usdCentSeconds = BigInt(0);
	for (const { positionAddress, snapshot } of changes) {
		if (walletValue > BigInt(0) && walletValue >= minimumWalletUsdCents) {
			const seconds = BigInt(snapshot.atSeconds - cursor);
			qualifyingSeconds += seconds;
			usdCentSeconds += walletValue * seconds;
		}
		cursor = snapshot.atSeconds;
		walletValue +=
			snapshot.usdCents - (values.get(positionAddress) ?? BigInt(0));
		values.set(positionAddress, snapshot.usdCents);
	}
	if (walletValue > BigInt(0) && walletValue >= minimumWalletUsdCents) {
		const seconds = BigInt(endSeconds - cursor);
		qualifyingSeconds += seconds;
		usdCentSeconds += walletValue * seconds;
	}
	return { qualifyingSeconds, usdCentSeconds };
}

export function timeWeightedLiquidityUsdCentSeconds(
	snapshots: readonly LiquidityValueSnapshot[],
	startSeconds: number,
	endSeconds: number,
	minimumQualifyingUsdCents: bigint,
): bigint {
	return summarizeLiquidityParticipation(
		snapshots,
		startSeconds,
		endSeconds,
		minimumQualifyingUsdCents,
	).usdCentSeconds;
}
