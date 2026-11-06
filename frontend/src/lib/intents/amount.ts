/** Decimal text <-> base units without floating point. Amounts here move real money. */

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** "1.5" with 6 decimals -> "1500000". Returns null for anything that is not a positive amount with at most `decimals` places. */
export function toBaseUnits(text: string, decimals: number): string | null {
	const match = DECIMAL.exec(text.trim());
	if (!match || !Number.isInteger(decimals) || decimals < 0 || decimals > 36)
		return null;
	const [, whole, fraction = ""] = match;
	if (fraction.length > decimals) return null;
	const digits = (whole + fraction.padEnd(decimals, "0")).replace(
		/^0+(?=\d)/,
		"",
	);
	return /^0+$/.test(digits) ? null : digits;
}

/** "1500000" with 6 decimals -> "1.5". */
export function fromBaseUnits(
	units: string,
	decimals: number,
	maxFraction = 6,
): string {
	if (!/^\d+$/.test(units)) return "0";
	const padded = units.padStart(decimals + 1, "0");
	const whole = padded.slice(0, padded.length - decimals) || "0";
	let fraction = decimals > 0 ? padded.slice(padded.length - decimals) : "";
	fraction = fraction.slice(0, maxFraction).replace(/0+$/, "");
	return fraction ? `${whole}.${fraction}` : whole;
}
