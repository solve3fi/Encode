import { useLingui } from "@lingui/react";
import { Percentage } from "@solve3fi/common";
import { type PoolRangeTypes, PriceRange } from "@/stores/pool";

export const usePoolRanges = (): PoolRangeTypes[] => {
	const { i18n } = useLingui();
	return (() => [
		{
			active: 1,
			type: PriceRange.FULL_RANGE,
			label: i18n._("Full Range"),
			demission: null,
		},
		{
			active: 2,
			type: PriceRange.BPS_20000,
			label: i18n._("Wide"),
			demission: Percentage.fromFraction(20000, 10000),
		},
		{
			active: 3,
			type: PriceRange.BPS_12000,
			label: i18n._("Balanced"),
			demission: Percentage.fromFraction(12000, 10000),
		},
		{
			active: 4,
			type: PriceRange.BPS_10100,
			label: i18n._("Narrow"),
			demission: Percentage.fromFraction(11000, 10000),
		},
	])();
};

export const usePoolRangeInfo = () => {
	const ranges = usePoolRanges();
	const getRange = (
		() => (type: PriceRange) =>
			ranges.find((range) => range.type === type)
	)();
	return { ranges, getRange };
};
