import { useLingui } from "@lingui/react";
import { FeeAmount, type FeeTierTypes } from "@/stores/pool";

export const useFeeTiers = (): FeeTierTypes[] => {
	const { i18n } = useLingui();
	return (() => [
		{
			fee: FeeAmount.LOWEST,
			label: i18n._("Best for very stable pairs."),
			description: i18n._("Best for very stable pairs."),
			select: 4,
			tickSpacing: 1,
		},
		{
			fee: FeeAmount.LOW_200,
			label: i18n._("Best for stable pairs."),
			description: i18n._("Best for stable pairs."),
			select: 12,
			tickSpacing: 2,
		},
		{
			fee: FeeAmount.HIGH,
			label: i18n._("Best for most pairs."),
			description: i18n._("Best for most pairs."),
			select: 64,
			tickSpacing: 128,
			featured: true,
		},
		{
			fee: FeeAmount.HIGH_650,
			label: i18n._("Best for exotic pairs."),
			description: i18n._("Best for exotic pairs."),
			select: 8,
			tickSpacing: 96,
		},
		{
			fee: FeeAmount.MEDIUM,
			label: i18n._("Best for exotic pairs."),
			description: i18n._("Best for exotic pairs."),
			select: 8,
			tickSpacing: 64,
		},
		{
			fee: FeeAmount.HIGH_160,
			label: i18n._("Best for exotic pairs."),
			description: i18n._("Best for exotic pairs."),
			select: 8,
			tickSpacing: 16,
		},
		{
			fee: FeeAmount.LOW,
			label: i18n._("Best for exotic pairs."),
			description: i18n._("Best for exotic pairs."),
			select: 8,
			tickSpacing: 8,
		},
		{
			fee: FeeAmount.HIGH_2000,
			label: i18n._("Best for exotic pairs."),
			description: i18n._("Best for exotic pairs."),
			select: 8,
			tickSpacing: 256,
		},
		{
			fee: FeeAmount.HIGH_3000,
			label: i18n._("Best for exotic pairs."),
			description: i18n._("Best for exotic pairs."),
			select: 8,
			tickSpacing: 384,
		},
		{
			fee: FeeAmount.HIGH_4000,
			label: i18n._("Best for exotic pairs."),
			description: i18n._("Best for exotic pairs."),
			select: 8,
			tickSpacing: 512,
		},
		{
			fee: FeeAmount.HIGH_5000,
			label: i18n._("Best for exotic pairs."),
			description: i18n._("Best for exotic pairs."),
			select: 8,
			tickSpacing: 640,
		},
	])();
};

export const useFeeTierInfo = () => {
	const feeTiers = useFeeTiers();
	const getFeeTier = (fee: FeeAmount) =>
		feeTiers.find((feeTier) => feeTier.fee === Number(fee));

	return { feeTiers, getFeeTier };
};
