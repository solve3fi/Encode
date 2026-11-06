import { useLingui } from "@lingui/react";
import {
	Avatar,
	Badge,
	Button,
	Group,
	NumberFormatter,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { Percentage } from "@solve3fi/common";
import { type Position, TickUtil } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import Link from "next/link";
import { CurrencyLogo } from "../Token/CurrencyLogo";
import { TokenBalance } from "../Token/TokenBalance";
import { TokenPrice } from "../Token/TokenPrice";
import { LiquidityDataPositionWrapper } from "./LiquidityDataPositionWrapper";
import { LiquidityRewardFee } from "./LiquidityRewardFee";
import { PositionBonusCredit } from "./PositionBonusCredit";

/** True when the position spans the whole price range its fee tier allows. */
export const isFullRangePosition = (position: Position) => {
	const pool = position.getSolveData();
	const { tickLowerIndex, tickUpperIndex } = position.getData();
	return TickUtil.isFullRange(pool.tickSpacing, tickLowerIndex, tickUpperIndex);
};

/**
 * One price bound in a short, readable form. Ordinary prices keep their digits; extreme ones (a tiny lower bound
 * or a huge upper bound) use exponent form so a bound never prints as a 20-digit run.
 */
const formatBound = (value: Decimal, digits: number) => {
	if (value.isZero()) return "0";
	const rounded = value.toSignificantDigits(digits);
	const magnitude = rounded.abs();
	return magnitude.gte("0.000001") && magnitude.lt("1e12")
		? rounded.toFixed()
		: rounded.toExponential();
};

/** Both bounds, with as many significant digits as it takes (up to 9) for a very narrow range to show two different numbers. */
export const formatRangeBounds = (
	lower: Decimal,
	upper: Decimal,
): [string, string] => {
	let pair: [string, string] = [formatBound(lower, 5), formatBound(upper, 5)];
	for (
		let digits = 6;
		digits <= 9 && pair[0] === pair[1] && !lower.eq(upper);
		digits++
	)
		pair = [formatBound(lower, digits), formatBound(upper, digits)];
	return pair;
};

/** "Full Range", or the price bounds with the quote unit, for one position. */
export const PositionRange: React.FC<{ position: Position }> = ({
	position,
}) => {
	const { i18n } = useLingui();
	return (
		<LiquidityDataPositionWrapper data={position}>
			{({ currencyA, currencyB, lowerPrice, upperPrice }) =>
				isFullRangePosition(position) ? (
					<Text fz="sm" fw="bold">
						{i18n._("Full Range")}
					</Text>
				) : (
					<Text fz="xs" fw="bold" c="gray" style={{ overflowWrap: "anywhere" }}>
						{lowerPrice && upperPrice
							? formatRangeBounds(lowerPrice, upperPrice).join(" – ")
							: "—"}
						<Text span c="gray.9" inherit ml={4}>
							{currencyB?.symbol} {i18n._("per")} {currencyA?.symbol}
						</Text>
					</Text>
				)
			}
		</LiquidityDataPositionWrapper>
	);
};

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<Text
		fz="xs"
		c="dimmed"
		tt="uppercase"
		fw={600}
		style={{ letterSpacing: "0.06em" }}
	>
		{children}
	</Text>
);

/** One of my positions as a card, for narrow screens where a wide table would have to scroll sideways. */
export const PositionCard: React.FC<{
	position: Position;
	hasIncentives: boolean;
}> = ({ position, hasIncentives }) => {
	const { i18n } = useLingui();
	const address = position.getAddress().toString();
	return (
		<LiquidityDataPositionWrapper data={position}>
			{({ currencyA, currencyB, outOfRange, tokenAAmount, tokenBAmount }) => (
				<Paper
					p="md"
					radius="lg"
					style={{
						background: "#0e0e1c",
						border: "1px solid rgba(246, 245, 249, 0.1)",
					}}
				>
					<Stack gap="md">
						<Group justify="space-between" wrap="nowrap" align="flex-start">
							<Group gap={10} wrap="nowrap">
								<Avatar.Group>
									<CurrencyLogo currency={currencyA} size={32} />
									<CurrencyLogo currency={currencyB} size={32} />
								</Avatar.Group>
								<Stack gap={0}>
									<Text fw="bold">{`${currencyA?.symbol}/${currencyB?.symbol}`}</Text>
									<Text size="xs" c="gray">
										<NumberFormatter
											value={Percentage.fromFraction(
												position.getSolveData().feeRate,
												10000,
											)
												.toDecimal()
												.toString()}
											suffix={`% ${i18n._("Fee Tier")}`}
										/>
									</Text>
								</Stack>
							</Group>
							<Badge
								variant="outline"
								radius="sm"
								color={outOfRange ? "error.8" : "success.8"}
								size="md"
							>
								{outOfRange ? i18n._("Out of Range") : i18n._("In Range")}
							</Badge>
						</Group>

						<Group grow align="flex-start" wrap="nowrap">
							<Stack gap={2}>
								<Label>{i18n._("Range")}</Label>
								<PositionRange position={position} />
							</Stack>
							<Stack gap={2}>
								<Label>{i18n._("My Pool Size")}</Label>
								<Text fw="bold">
									<TokenPrice
										addresses={
											currencyA && currencyB
												? {
														[currencyA.address]: tokenAAmount?.toNumber() || 0,
														[currencyB.address]: tokenBAmount?.toNumber() || 0,
													}
												: {}
										}
										prefix="$"
										decimalScale={2}
									/>
								</Text>
							</Stack>
						</Group>

						<Stack gap={2}>
							<Label>{i18n._("Deposited")}</Label>
							<Group gap="md">
								<Text fz="sm" fw="bold">
									<TokenBalance
										value={tokenAAmount?.toSignificantDigits(6).toString()}
										loading={false}
										decimalScale={5}
									/>
									<Text span c="gray.9" inherit ml={5}>
										{currencyA?.symbol}
									</Text>
								</Text>
								<Text fz="sm" fw="bold">
									<TokenBalance
										value={tokenBAmount?.toSignificantDigits(6).toString()}
										loading={false}
										decimalScale={5}
										prefix=""
									/>
									<Text span c="gray.9" inherit ml={5}>
										{currencyB?.symbol}
									</Text>
								</Text>
							</Group>
						</Stack>

						<Group grow align="flex-start" wrap="nowrap">
							<Stack gap={2}>
								<Label>{i18n._("Rewards")}</Label>
								<LiquidityRewardFee positionId={address} />
							</Stack>
							{hasIncentives && (
								<Stack gap={2}>
									<Label>{i18n._("veSOLV3 bonus")}</Label>
									<PositionBonusCredit
										poolAddress={position.getData().solve.toString()}
									/>
								</Stack>
							)}
						</Group>

						<Button
							size="md"
							fullWidth
							component={Link}
							href={`/liquidity/manager?positionId=${address}`}
						>
							{i18n._("Manage")}
						</Button>
					</Stack>
				</Paper>
			)}
		</LiquidityDataPositionWrapper>
	);
};
