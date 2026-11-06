/** Epoch-1 emission and its weekly decay (Charter: Emission(n) = 1,300,000 × 0.98^(n−1)). */
export const EPOCH_ONE_EMISSION = 1_300_000;
export const EMISSION_DECAY = 0.98;
/** Share of each epoch's emission streamed to voted gauges. */
export const GAUGE_EMISSION_SHARE = 0.96;

export const epochEmission = (epoch: number) =>
	EPOCH_ONE_EMISSION * EMISSION_DECAY ** Math.max(0, epoch - 1);

/** Estimated SOLV3 a gauge receives this epoch for a given vote share (percent). */
export const estimateGaugeSolv3 = (epoch: number, sharePercent: number) =>
	epochEmission(epoch) * GAUGE_EMISSION_SHARE * (sharePercent / 100);
