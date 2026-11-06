import { Text } from "@mantine/core";
import { type Address, DecimalUtil } from "@solve3fi/common";
import BN from "bn.js";
import type React from "react";
import { usePositionFeesQuote } from "@/hooks/usePositionFeesQuote";
import { usePositionEmissionQuote } from "@/hooks/usePositionEmissionQuote";
import { usePositionInfo } from "@/hooks/usePositionInfo";
import { useToken } from "@/hooks/useToken";
import { TokenPrice } from "../Token/TokenPrice";

export type LiquidityRewardFeeProps = {
	positionId: Address;
};

export const LiquidityRewardFee: React.FC<LiquidityRewardFeeProps> = ({
	positionId,
}) => {
	const { data: position } = usePositionInfo(positionId);
	const { data: fees } = usePositionFeesQuote(position);
	const { data: emissions } = usePositionEmissionQuote(position);
	// Gauge emissions (SOLV3) count toward the Rewards total, not just trading fees.
	const emission = emissions?.[0];
	const emissionToken = useToken(emission?.mint);

	const currencyA = useToken(position?.getSolveData().tokenMintA.toString());
	const currencyB = useToken(position?.getSolveData().tokenMintB.toString());

	const amounts: Record<string, number> =
		currencyA && currencyB
			? {
					[currencyA.address]:
						DecimalUtil.fromBN(
							fees?.[0] || new BN(0),
							currencyA.decimals,
						).toNumber() || 0,
					[currencyB.address]:
						DecimalUtil.fromBN(
							fees?.[1] || new BN(0),
							currencyB.decimals,
						).toNumber() || 0,
				}
			: {};
	let emissionAmount = 0;
	if (emission && emissionToken) {
		emissionAmount =
			DecimalUtil.fromBN(emission.amount, emissionToken.decimals).toNumber() || 0;
		amounts[emissionToken.address] =
			(amounts[emissionToken.address] ?? 0) + emissionAmount;
	}

	return (
		<>
			<Text fw="bold">
				<TokenPrice addresses={amounts} prefix="$" decimalScale={2} />
			</Text>
			{emissionAmount > 0 && emissionToken && (
				<Text size="xs" c="dimmed">
					{emissionAmount.toLocaleString(undefined, {
						maximumFractionDigits: 2,
					})}{" "}
					{emissionToken.symbol}
				</Text>
			)}
		</>
	);
};
