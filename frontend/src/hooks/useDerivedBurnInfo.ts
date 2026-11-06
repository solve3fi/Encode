import { useLingui } from "@lingui/react";
import { DecimalUtil, Percentage } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PoolUtil, type Position, PriceMath } from "@solve3fi/sdk";
import BN from "bn.js";
import Decimal from "decimal.js";
import type { ReactNode } from "react";
import { useAnchor } from "@/providers/DappProvider";
import { usePoolManager } from "@/stores/pool-manager/PoolManagaerProvider";
import { useToken } from "./useToken";

export const useDerivedBurnInfo = (
	position?: Position,
): {
	liquidityPercentage?: Percentage;
	liquidityValue0?: Decimal;
	liquidityValue1?: Decimal;
	outOfRange?: boolean;
	errorMessage?: ReactNode | undefined;
	token0?: TokenInfo | null;
	token1?: TokenInfo | null;
	liquidityAmount?: BN;
} => {
	const { i18n } = useLingui();
	const { publicKey } = useAnchor();
	const removePercent = usePoolManager((state) => state.removePercent);

	const token0 = useToken(position?.getSolveData().tokenMintA.toString());
	const token1 = useToken(position?.getSolveData().tokenMintB.toString());

	const liquidityPercentage = Percentage.fromFraction(removePercent, 100);

	const pool = position?.getSolveData();
	const currentBalance = PoolUtil.getTokenAmountsFromLiquidity(
		position?.getData().liquidity ?? new BN(0),
		pool?.sqrtPrice ?? new BN(0),
		PriceMath.tickIndexToSqrtPriceX64(position?.getData().tickLowerIndex ?? 0),
		PriceMath.tickIndexToSqrtPriceX64(position?.getData().tickUpperIndex ?? 0),
		false,
	);

	const liquidityValue0 = DecimalUtil.fromBN(
		currentBalance.tokenA,
		token0?.decimals,
	).mul(liquidityPercentage.toDecimal());

	const liquidityValue1 = DecimalUtil.fromBN(
		currentBalance.tokenB,
		token1?.decimals,
	).mul(liquidityPercentage.toDecimal());

	const liquidity = new Decimal(
		position?.getData().liquidity.toString() || "0",
	);
	const liquidityAmount = new BN(
		liquidity.mul(liquidityPercentage.toDecimal()).floor().toString(),
	);

	const outOfRange =
		pool && position
			? pool.tickCurrentIndex < position.getData().tickLowerIndex ||
				pool.tickCurrentIndex > position.getData().tickUpperIndex
			: false;

	let errorMessage: ReactNode | undefined;

	if (liquidityAmount.gt(position?.getData().liquidity ?? new BN(0))) {
		errorMessage = i18n.t("Invalid percentage");
	}

	if (!publicKey) {
		errorMessage = i18n.t("Connect Wallet");
	}

	if (removePercent === 0) {
		errorMessage = errorMessage ?? i18n.t("Invalid percentage");
	}

	return {
		liquidityPercentage,
		liquidityValue0,
		liquidityValue1,
		outOfRange,
		errorMessage,
		token0,
		token1,
		liquidityAmount,
	};
};
