import { useLingui } from "@lingui/react";
import {
	Avatar,
	Badge,
	Button,
	Divider,
	Group,
	NumberFormatter,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { Percentage } from "@solve3fi/common";
import type { Position } from "@solve3fi/sdk";
import Link from "next/link";
import { LiquidityDataPositionWrapper } from "../Liquidity/LiquidityDataPositionWrapper";
import { CurrencyLogo } from "../Token/CurrencyLogo";
import { RewardEmissionApr } from "./RewardEmissionApr";
import { RewardHandleCollectFee } from "./RewardHandleCollectFee";
import { RewardLiquidityFees } from "./RewardLiquidityFees";
import { RewardPoolFeeVault } from "./RewardPoolFeeVault";

// Same reason as RewardVoteListsMobile: the desktop table's columns total
// well over 900px and the Claim control is the rightmost one, so on a phone
// it lands far outside the ScrollArea's visible width with no scrollbar to
// hint at it. Cards keep every row's claim on screen, matching the card
// treatment VoteListsMobile already uses for the Vote page.
export const RewardListsMobile: React.FC<{ records: Position[] }> = ({
	records,
}) => {
	const { i18n } = useLingui();

	return (
		<SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="xs">
			{records.map((record) => {
				const positionId = record.getAddress().toString();
				return (
					<Paper key={positionId} p="sm" radius="md" withBorder>
						<Stack gap={6}>
							<LiquidityDataPositionWrapper data={record}>
								{({ currencyA, currencyB }) => (
									<Group gap={8}>
										<Avatar.Group>
											<CurrencyLogo currency={currencyA} size={26} />
											<CurrencyLogo currency={currencyB} size={26} />
										</Avatar.Group>
										<Stack gap={0}>
											<Text fw="bold" size="sm">
												{`${currencyA?.symbol}/${currencyB?.symbol}`}
											</Text>
											<Text size="xs" c="gray">
												<NumberFormatter
													value={Percentage.fromFraction(
														record.getSolveData().feeRate,
														10000,
													)
														.toDecimal()
														.toString()}
													suffix={`% ${i18n._("Fee Tier")}`}
												/>
											</Text>
										</Stack>
									</Group>
								)}
							</LiquidityDataPositionWrapper>

							<Divider />

							<Group justify="space-between">
								<Text size="xs" c="gray">
									{i18n._("Range")}
								</Text>
								<LiquidityDataPositionWrapper data={record}>
									{({ outOfRange }) => (
										<Badge
											variant="outline"
											radius="sm"
											color={outOfRange ? "error.8" : "success.8"}
											p={10}
											size="sm"
										>
											{outOfRange ? i18n._("Out of Range") : i18n._("In Range")}
										</Badge>
									)}
								</LiquidityDataPositionWrapper>
							</Group>

							<Group justify="space-between" align="flex-start">
								<Text size="xs" c="gray">
									{i18n._("Rewards")}
								</Text>
								<RewardLiquidityFees positionId={positionId} />
							</Group>

							<Group justify="space-between">
								<Text size="xs" c="gray">
									{i18n._("Emission APR")}
								</Text>
								<RewardEmissionApr
									poolAddress={record.getData().solve.toString()}
								/>
							</Group>

							<Button component={Link} href={`/liquidity/manager?positionId=${positionId}`} size="lg" variant="filled" fullWidth>
								{i18n._("Manage")}
							</Button>
							<RewardHandleCollectFee postionId={positionId} fullWidth />
							<RewardPoolFeeVault positionId={positionId} />
						</Stack>
					</Paper>
				);
			})}
		</SimpleGrid>
	);
};
