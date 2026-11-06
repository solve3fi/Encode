import { describe, expect, test } from "bun:test";
import { getEpochClockState } from "./epochClock";

describe("epoch clock states", () => {
	const end = 10_000;

	test("moves through each meaningful state", () => {
		expect(getEpochClockState(end, end - 301)).toBe("open");
		expect(getEpochClockState(end, end - 300)).toBe("final-hour");
		expect(getEpochClockState(end, end)).toBe("settling");
		expect(getEpochClockState(end + 604_800, end + 1, true)).toBe("settled");
	});
});
