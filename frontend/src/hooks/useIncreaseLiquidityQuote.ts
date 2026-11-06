import {
	type Address,
	AddressUtil,
	type Percentage,
} from "@solve3fi/common";
import { increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage } from "@solve3fi/sdk";
import type BN from "bn.js";
import { useTokenExtension } from "./useTokenExtension";

export const useIncreaseLiquidityQuote = (
	inputTokenAmount: BN | undefined,
	inputTokenMint: Address | undefined,
	tokenMintA: Address | undefined,
	tokenMintB: Address | undefined,
	tickCurrentIndex: number | undefined,
	sqrtPrice: BN | undefined,
	tickLowerIndex: number | undefined,
	tickUpperIndex: number | undefined,
	slippageTolerance: Percentage,
) => {
	const { data: tokenExtensionCtx } = useTokenExtension(tokenMintA, tokenMintB);

	if (
		!tokenExtensionCtx ||
		!inputTokenAmount ||
		!inputTokenMint ||
		!tokenMintA ||
		!tokenMintB ||
		!sqrtPrice ||
		typeof tickCurrentIndex !== "number" ||
		typeof tickLowerIndex !== "number" ||
		typeof tickUpperIndex !== "number"
	)
		return undefined;

	return increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage({
		inputTokenMint: AddressUtil.toPubKey(inputTokenMint),
		tokenMintA: AddressUtil.toPubKey(tokenMintA),
		tokenMintB: AddressUtil.toPubKey(tokenMintB),
		inputTokenAmount,
		tickCurrentIndex,
		sqrtPrice,
		tickLowerIndex,
		tickUpperIndex,
		slippageTolerance,
		tokenExtensionCtx,
	});
};
