import { describe, expect, test } from "bun:test";
import {
	formatAddress,
	formatApr,
	formatDuration,
	formatFiat,
	formatPercentage,
	formatTokenAmount,
} from "./format";

describe("protocol number formatting", () => {
	test("formats verifiable token balances without forced trailing zeros", () => {
		expect(formatTokenAmount(1_234.5, { decimals: 6 })).toBe("1,234.5");
		expect(formatTokenAmount(0.0004)).toBe("<0.001");
	});

	test("uses compact notation only when requested", () => {
		expect(formatTokenAmount(1_300_000, { compact: true })).toBe("1.3M");
		expect(formatTokenAmount(1_300_000, { decimals: 0 })).toBe("1,300,000");
	});

	test("distinguishes vote percentages from round constants", () => {
		expect(formatPercentage(12.5)).toBe("12.50%");
		expect(formatPercentage(96, { protocolConstant: true })).toBe("96%");
	});

	test("labels and caps annualized rates", () => {
		expect(formatApr(12.5, { ceiling: 10_000 })).toBe("12.50% APR");
		expect(formatApr(12_345, { ceiling: 10_000 })).toBe(">10,000% APR");
		expect(formatApr(null, { ceiling: 10_000 })).toBe("—");
	});

	test("does not invent unavailable fiat values", () => {
		expect(formatFiat(null)).toBeNull();
		expect(formatFiat(12.5)).toBe("$12.50");
	});

	test("formats addresses and shared countdown durations", () => {
		expect(formatAddress("1234567890abcdef")).toBe("1234…cdef");
		expect(formatDuration(90_061)).toBe("1d 01:01:01");
		expect(formatDuration(3_661)).toBe("01:01:01");
	});
});
