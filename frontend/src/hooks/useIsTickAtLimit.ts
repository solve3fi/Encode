import { TickUtil } from "@solve3fi/sdk";
import { useMemo } from "react";
import { type FeeAmount, PriceInputs, TICK_SPACINGS } from "@/stores/pool";

export default function useIsTickAtLimit(
	feeAmount: FeeAmount | undefined,
	tickLower: number | undefined,
	tickUpper: number | undefined,
) {
	return useMemo(
		() => ({
			[PriceInputs.LOWER]:
				feeAmount && tickLower && tickUpper
					? TickUtil.isFullRange(TICK_SPACINGS[feeAmount], tickLower, tickUpper)
					: undefined,
			[PriceInputs.UPPER]:
				feeAmount && tickUpper && tickLower
					? TickUtil.isFullRange(TICK_SPACINGS[feeAmount], tickLower, tickUpper)
					: undefined,
		}),
		[feeAmount, tickLower, tickUpper],
	);
}
