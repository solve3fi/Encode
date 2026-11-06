import { Stack, Text } from "@mantine/core";
import { type Address, DecimalUtil } from "@solve3fi/common";
import BN from "bn.js";
import type React from "react";
import { useMemo } from "react";
import { usePositionFeesQuote } from "@/hooks/usePositionFeesQuote";
import { usePositionInfo } from "@/hooks/usePositionInfo";
import { useRewardFeesQuote } from "@/hooks/useRewardFeesQuote";
import { useTokens } from "@/hooks/useToken";
import { TokenBalance } from "../Token/TokenBalance";
import { TokenPrice } from "../Token/TokenPrice";

export type RewardLiquidityFeesProps = {
	positionId: Address;
};

export const RewardLiquidityFeeLists: React.FC<{
	rewards: Record<string, BN>;
}> = ({ rewards }) => {
	const tokens = useTokens(Object.keys(rewards));

	return (
		<Stack gap={2}>
			<Text fw="bold">
				<TokenPrice
					addresses={
						tokens
							? Object.entries(rewards).reduce(
									(acc, [address, amount], index) => {
										acc[address] = DecimalUtil.fromBN(
											amount,
											tokens[index]?.decimals,
										)
											.toSignificantDigits(5)
											.toNumber();
										return acc;
									},
									{} as Record<string, number>,
								)
							: {}
					}
					prefix="$"
					decimalScale={2}
				/>
			</Text>

			<Stack gap={0}>
				{Object.entries(rewards).map(([address, amount], index) => (
					<Text key={address} fz="xs" fw="bold" lh={1} c="gray">
						<TokenBalance
							key={address}
							value={DecimalUtil.fromBN(
								amount,
								tokens?.[index]?.decimals,
							).toNumber()}
							loading={false}
							decimalScale={5}
							prefix=""
						/>
						<Text span c="gray.9" inherit ml={5}>
							{tokens?.[index]?.symbol}
						</Text>
					</Text>
				))}
			</Stack>
		</Stack>
	);
};

export const RewardLiquidityFees: React.FC<RewardLiquidityFeesProps> = ({
	positionId,
}) => {
	const { data: position } = usePositionInfo(positionId);
	const { data: fees } = usePositionFeesQuote(position);
	const { data: rewards } = useRewardFeesQuote(position);

	const addressMap = useMemo(() => {
		const map: Record<string, BN> = {};

		if (
			position?.getSolveData().tokenMintA &&
			position?.getSolveData().tokenMintB
		) {
			map[position?.getSolveData().tokenMintA.toString()] =
				fees?.[0] || new BN(0);
			map[position?.getSolveData().tokenMintB.toString()] =
				fees?.[1] || new BN(0);
		}

		position?.getSolveData().rewardInfos?.map((item, index) => {
			if (rewards?.[index]?.gt(new BN(0))) {
				map[item.mint.toString()] = rewards?.[index] || new BN(0);
			}
		});

		return map;
	}, [fees, rewards, position]);

	return addressMap && <RewardLiquidityFeeLists rewards={addressMap} />;
};
