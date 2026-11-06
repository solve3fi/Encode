"use client";

import { useLingui } from "@lingui/react";
import {
	Avatar,
	Badge,
	Button,
	em,
	Group,
	NumberFormatter,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Percentage } from "@solve3fi/common";
import type { Position } from "@solve3fi/sdk";
import {
	IconChevronUp,
	IconSelector,
} from "@tabler/icons-react";
import sortBy from "lodash/sortBy";
import { DataTable, type DataTableSortStatus } from "mantine-datatable";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAllPositions } from "@/hooks/useAllPositions";
import { usePositions } from "@/hooks/usePositions";
import { useAllTokens } from "@/hooks/useToken";
import { useReward } from "@/stores/reward/RewardProvider";
import { LiquidityDataPositionWrapper } from "../Liquidity/LiquidityDataPositionWrapper";
import { filterPositionsBySearch } from "../Liquidity/LiquidityMyLists";
import { CurrencyLogo } from "../Token/CurrencyLogo";
import { RewardEmissionApr } from "./RewardEmissionApr";
import { RewardHandleCollectFee } from "./RewardHandleCollectFee";
import { RewardLiquidityFees } from "./RewardLiquidityFees";
import classes from "./RewardList.module.css";
import { RewardListsMobile } from "./RewardListsMobile";
import { RewardPoolFeeVault } from "./RewardPoolFeeVault";

export const RewardLists: React.FC = () => {
	const { i18n } = useLingui();
	const tokenMap = useAllTokens();
	const filter = useReward((state) => state.filter);
	const { data: allPositions, isLoading: positionsLoading } = useAllPositions();
	const { data: positions, isLoading: positionLoading } =
		usePositions(allPositions);

	const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Position>>({
		columnAccessor: "tokenAInfo.address",
		direction: "asc",
	});
	const [records, setRecords] = useState(
		sortBy(
			filterPositionsBySearch(positions, filter, tokenMap),
			"tokenAInfo.address",
		),
	);

	useEffect(() => {
		const data = sortBy(
			filterPositionsBySearch(positions, filter, tokenMap),
			sortStatus.columnAccessor,
		);
		setRecords(sortStatus.direction === "desc" ? data.reverse() : data);
		// tokenMap intentionally excluded -- see the comment in LiquidityLists.tsx.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [positions, sortStatus, filter]);

	const isLoading = positionsLoading || positionLoading;
	// Same breakpoint RewardWrapper already splits this page's filter bar on,
	// and the one VoteLists uses to fall back to cards.
	const isNarrow = useMediaQuery(`(max-width: ${em(1024)})`);

	if (!isLoading && records.length === 0) {
		return (
			<Paper p="xl" radius="md" withBorder>
				<Stack align="flex-start" gap="sm">
					<Stack gap={4}>
						<Text fw={700}>{i18n._("No liquidity positions yet")}</Text>
						<Text c="dimmed">
							{i18n._("Deposit liquidity to start earning fees and emissions.")}
						</Text>
					</Stack>
					<Button component={Link} href="/liquidity">
						{i18n._("Explore pools")}
					</Button>
				</Stack>
			</Paper>
		);
	}

	if (isNarrow) {
		return <RewardListsMobile records={records} />;
	}

	return (
		<Stack gap="md">
			<DataTable
				withTableBorder={false}
				withColumnBorders={false}
				withRowBorders={false}
				miw={900}
				className={classes.root}
				rowClassName={classes.row}
				verticalSpacing="md"
				records={records}
				fetching={isLoading}
				minHeight={150}
				idAccessor={(record: Position) =>
					`${record.getSolveData().tokenMintA}-${record.getSolveData().tokenMintB}-${record.getSolveData().feeRate}`
				}
				sortIcons={{
					sorted: (
						<IconChevronUp
							size={14}
							stroke={2}
							color="var(--mantine-color-purple-8)"
						/>
					),
					unsorted: <IconSelector stroke={2} size={14} />,
				}}
				columns={[
					{
						accessor: "tokenAInfo.address",
						title: i18n._("Pair"),
						width: 280,
						render: (record: Position) => (
							<LiquidityDataPositionWrapper data={record}>
								{({ currencyA, currencyB }) => (
									<Group gap={10}>
										<Avatar.Group>
											<CurrencyLogo currency={currencyA} size={32} />
											<CurrencyLogo currency={currencyB} size={32} />
										</Avatar.Group>
										<Stack gap={0}>
											<Text fw="bold">{`${currencyA?.symbol}/${currencyB?.symbol}`}</Text>
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
						),
					},
					{
						accessor: "type.name",
						title: i18n._("Range"),
						width: 150,
						sortable: true,
						render: (record: Position) => (
							<LiquidityDataPositionWrapper data={record}>
								{({ outOfRange }) => (
									<Badge
										variant="outline"
										radius="sm"
										color={outOfRange ? "error.8" : "success.8"}
										p={10}
										size="sm"
										w="fit-content"
									>
										{outOfRange ? i18n._("Out of Range") : i18n._("In Range")}
									</Badge>
								)}
							</LiquidityDataPositionWrapper>
						),
					},

					{
						accessor: "reward.usd",
						title: i18n._("Rewards"),
						sortable: true,
						render: (position: Position) => (
							<RewardLiquidityFees
								positionId={position.getAddress().toString()}
							/>
						),
					},
					{
						accessor: "emission",
						title: i18n._("Emission APR"),
						sortable: true,
						render: (position: Position) => (
							<RewardEmissionApr
								poolAddress={position.getData().solve.toString()}
							/>
						),
					},

					{
						accessor: "action",
						title: "",
						width: 220,
						render: (position: Position) => (
							<Stack gap={6} align="flex-end">
								<Button
									component={Link}
									href={`/liquidity/manager?positionId=${position.getAddress().toString()}`}
									size="lg"
									variant="filled"
									fullWidth
								>
									{i18n._("Manage")}
								</Button>
								<RewardHandleCollectFee
									postionId={position.getAddress().toString()}
								/>
								<RewardPoolFeeVault
									positionId={position.getAddress().toString()}
								/>
							</Stack>
						),
					},
				]}
				sortStatus={sortStatus}
				onSortStatusChange={setSortStatus}
			/>
		</Stack>
	);
};
