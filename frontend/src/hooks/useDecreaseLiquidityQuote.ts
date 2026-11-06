import type { Address, Percentage } from "@solve3fi/common";
import { decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage } from "@solve3fi/sdk";
import type BN from "bn.js";
import { useTokenExtension } from "./useTokenExtension";

export const useDecreaseLiquidityQuote = (
	liquidity: BN | undefined,
	tickCurrentIndex: number | undefined,
	sqrtPrice: BN | undefined,
	tickLowerIndex: number | undefined,
	tickUpperIndex: number | undefined,
	slippageTolerance: Percentage,
	tokenMintA: Address | undefined,
	tokenMintB: Address | undefined,
) => {
	const { data: tokenExtensionCtx } = useTokenExtension(tokenMintA, tokenMintB);

	if (
		!liquidity ||
		!tokenExtensionCtx ||
		!tokenMintA ||
		!tokenMintB ||
		!sqrtPrice ||
		typeof tickCurrentIndex !== "number" ||
		typeof tickLowerIndex !== "number" ||
		typeof tickUpperIndex !== "number"
	)
		return undefined;

	return decreaseLiquidityQuoteByLiquidityWithParamsUsingPriceSlippage({
		liquidity,
		tickCurrentIndex,
		sqrtPrice,
		tickLowerIndex,
		tickUpperIndex,
		slippageTolerance,
		tokenExtensionCtx,
	});
};
