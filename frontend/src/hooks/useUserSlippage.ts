import { Percentage } from "@solve3fi/common";
import BN from "bn.js";
import { useApplication } from "@/stores/application/ApplicationProvider";

export const useUserSlippageTolerance = (): Percentage | "auto" => {
	const slippage = useApplication((state) => state.slippage);
	// `slippage` is a plain percent (e.g. 0.5 means "0.5%"), so the fraction
	// needs a /100 baked in on top of the /1000 precision scaling — denominator
	// 100_000, not 1000. With 1000 the numerator (percent*1000) equaled the
	// denominator once the user picked 1% and exceeded it above 1%, which the
	// SDK's getSlippageBoundForSqrtPrice takes as denominator-minus-numerator
	// under a sqrt: zero at exactly 1%, negative (NaN, then "Invalid character"
	// from BN parsing "NaN") above it. Below 1% it silently produced a
	// tolerance 100x wider than intended instead of crashing.
	return slippage === "auto"
		? "auto"
		: new Percentage(
				new BN(Math.floor(Number(slippage) * 1000)),
				new BN(100_000),
			);
};

export const useUserSlippageToleranceWithDefault = (
	defaultSlippageTolerance: Percentage,
): Percentage => {
	const allowedSlippage = useUserSlippageTolerance();
	return allowedSlippage === "auto"
		? defaultSlippageTolerance
		: allowedSlippage;
};
