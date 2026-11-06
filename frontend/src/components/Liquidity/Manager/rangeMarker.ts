import type Decimal from "decimal.js";

/** Marker position as a percentage, clamped to the bar: (current - min) / (max - min). */
export const markerPercent = (
	current: Decimal | undefined,
	min: Decimal | undefined,
	max: Decimal | undefined,
): number | undefined => {
	if (!current || !min || !max || max.lte(min)) return undefined;
	const raw = current.minus(min).div(max.minus(min)).mul(100).toNumber();
	if (!Number.isFinite(raw)) return undefined;
	return Math.min(100, Math.max(0, raw));
};
