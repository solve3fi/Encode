import { DecimalUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PoolUtil, type Position, PriceMath } from "@solve3fi/sdk";
import BN from "bn.js";
import Decimal from "decimal.js";
import { useToken } from "@/hooks/useToken";

export type LiquidityDataPositionWrapperProps = {
	data?: Position | null;
	children: (props: {
		record?: Position | null;
		currencyA?: TokenInfo | null;
		currencyB?: TokenInfo | null;
		outOfRange?: boolean;
		tokenAAmount?: Decimal | null;
		tokenBAmount?: Decimal | null;
		lowerPrice?: Decimal | null;
		upperPrice?: Decimal | null;
	}) => React.ReactNode;
};

export const LiquidityDataPositionWrapper: React.FC<
	LiquidityDataPositionWrapperProps
> = ({ data, children }) => {
	const pool = data?.getSolveData();

	const currencyA = useToken(pool?.tokenMintA.toString());
	const currencyB = useToken(pool?.tokenMintB.toString());

	const outOfRange =
		pool?.tickCurrentIndex && data?.getData()
			? pool.tickCurrentIndex < data.getData().tickLowerIndex ||
				pool.tickCurrentIndex > data.getData().tickUpperIndex
			: false;

	const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
		data?.getData().tickLowerIndex ?? 0,
	);
	const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(
		data?.getData().tickUpperIndex ?? 0,
	);
	const { tokenA, tokenB } = PoolUtil.getTokenAmountsFromLiquidity(
		data?.getData().liquidity ?? new BN(0),
		pool?.sqrtPrice ?? new BN(0),
		lowerSqrtPrice,
		upperSqrtPrice,
		true,
	);

	const tokenAAmount =
		DecimalUtil.fromBN(tokenA, currencyA?.decimals) || new Decimal(0);
	const tokenBAmount =
		DecimalUtil.fromBN(tokenB, currencyB?.decimals) || new Decimal(0);

	const lowerPrice = data
		? PriceMath.tickIndexToPrice(
				data.getData().tickLowerIndex,
				currencyA?.decimals ?? 0,
				currencyB?.decimals ?? 0,
			)
		: null;
	const upperPrice = data
		? PriceMath.tickIndexToPrice(
				data.getData().tickUpperIndex,
				currencyA?.decimals ?? 0,
				currencyB?.decimals ?? 0,
			)
		: null;

	return children({
		record: data,
		currencyA,
		currencyB,
		outOfRange,
		tokenAAmount,
		tokenBAmount,
		lowerPrice,
		upperPrice,
	});
};
