import { useLingui } from "@lingui/react";
import {
	Avatar,
	Badge,
	Button,
	Group,
	NumberFormatter,
	Stack,
	Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Percentage } from "@solve3fi/common";
import type { Position } from "@solve3fi/sdk";
import { IconChevronUp, IconSelector } from "@tabler/icons-react";
import sortBy from "lodash/sortBy";
import { DataTable, type DataTableSortStatus } from "mantine-datatable";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAllPositions } from "@/hooks/useAllPositions";
import { useLpIncentives } from "@/hooks/useLpIncentives";
import { usePositions } from "@/hooks/usePositions";
import { useAllTokens } from "@/hooks/useToken";
import { LiquidityTypes } from "@/stores/liquidity";
import { useLiquidity } from "@/stores/liquidity/LiquidityProvider";
import { CurrencyLogo } from "../Token/CurrencyLogo";
import { TokenBalance } from "../Token/TokenBalance";
import { TokenPrice } from "../Token/TokenPrice";
import { LiquidityDataPositionWrapper } from "./LiquidityDataPositionWrapper";
import { PositionCard, PositionRange } from "./LiquidityMyCards";
import classes from "./LiquidityMyTable.module.css";
import { LiquidityRewardFee } from "./LiquidityRewardFee";
import { PositionBonusCredit } from "./PositionBonusCredit";

export const filterPositions = (
	pools: Position[] | undefined,
	type: string,
) => {
	return pools?.filter((position: Position) => {
		// "all", or one fee tier expressed as its on-chain feeRate.
		if (type !== LiquidityTypes.ALL) {
			return position.getSolveData().feeRate === Number(type);
		}
		return true;
	});
};

export const filterPositionsBySearch = (
	positions: Position[] | undefined,
	search: string,
	tokenMap: ReturnType<typeof useAllTokens>,
) => {
	const query = search.trim().toLowerCase();
	if (!query) return positions;
	return positions?.filter((position: Position) => {
		const data = position.getSolveData();
		const mintA = data.tokenMintA.toString();
		const mintB = data.tokenMintB.toString();
		const symbolA = tokenMap[mintA]?.symbol ?? "";
		const symbolB = tokenMap[mintB]?.symbol ?? "";
		return (
			`${symbolA}/${symbolB}`.toLowerCase().includes(query) ||
			mintA.toLowerCase().includes(query) ||
			mintB.toLowerCase().includes(query)
		);
	});
};

export type LiquidityMyListsProps = {
	type: string;
};

export const LiquidityMyLists: React.FC<LiquidityMyListsProps> = ({ type }) => {
	const { i18n } = useLingui();
	const tokenMap = useAllTokens();
	const filter = useLiquidity((state) => state.filter);
	// Soft-launch LP incentive: the wallet's accrued veSOLV3 credit per pool.
	const { hasActive: hasIncentives, wallet: incentiveWallet, veSolv3Usd } = useLpIncentives();
	const totalBonusSolv3 = Number(incentiveWallet?.totalSolv3 ?? 0);

	// Narrow screens get one card per position instead of a table that scrolls sideways.
	const isMobile = useMediaQuery("(max-width: 48em)");
	const { data: allPositions, isLoading: positionsLoading } = useAllPositions();
	const { data: positions, isLoading: positionLoading } =
		usePositions(allPositions);

	const [sortStatus, setSortStatus] = useState<DataTableSortStatus<Position>>({
		columnAccessor: "tokenAInfo.address",
		direction: "asc",
	});
	const [records, setRecords] = useState(
		sortBy(
			filterPositionsBySearch(filterPositions(positions, type), filter, tokenMap),
			"tokenAInfo.address",
		),
	);

	useEffect(() => {
		const data = sortBy(
			filterPositionsBySearch(filterPositions(positions, type), filter, tokenMap),
			sortStatus.columnAccessor,
		);
		setRecords(sortStatus.direction === "desc" ? data.reverse() : data);
		// tokenMap intentionally excluded -- see the comment in LiquidityLists.tsx.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sortStatus, positions, type, filter]);

	return (
		<>
		{hasIncentives && totalBonusSolv3 > 0 && (
			<Group justify="flex-end" gap={6} mb="xs">
				<Text size="sm" c="gray">{i18n._("veSOLV3 bonus accrued")}</Text>
				<Text size="sm" fw="bold" data-numeric="true">
					<NumberFormatter value={totalBonusSolv3} decimalScale={2} thousandSeparator /> veSOLV3
				</Text>
				<Text size="sm" c="gray" data-numeric="true">
					(<NumberFormatter value={totalBonusSolv3 * veSolv3Usd} prefix="$" decimalScale={2} thousandSeparator />)
				</Text>
			</Group>
		)}
		{isMobile ? (
			<Stack gap="md">
				{positionsLoading || positionLoading ? (
					<Text c="dimmed" ta="center" py="md">
						{i18n._("Loading...")}
					</Text>
				) : records.length === 0 ? (
					<Text c="dimmed" ta="center" py="md">
						{i18n._("No positions found")}
					</Text>
				) : (
					records.map((record) => (
						<PositionCard
							key={record.getAddress().toString()}
							position={record}
							hasIncentives={hasIncentives}
						/>
					))
				)}
			</Stack>
		) : (
		<DataTable
			withTableBorder={false}
			withColumnBorders={false}
			withRowBorders={false}
			className={classes.root}
			rowClassName={classes.row}
			verticalSpacing="md"
			fetching={positionsLoading || positionLoading}
			records={records}
			idAccessor={(record: Position) => `${record.getAddress().toString()}`}
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
										<Text fw="bold">
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
					),
				},

				{
					accessor: "range",
					title: i18n._("Range"),
					width: 220,
					sortable: true,
					render: (record: Position) => (
						<LiquidityDataPositionWrapper data={record}>
							{({ outOfRange }) => (
								<Stack gap={4}>
									<PositionRange position={record} />
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
								</Stack>
							)}
						</LiquidityDataPositionWrapper>
					),
				},
				{
					accessor: "liquidity",
					title: i18n._("My Pool Size"),
					sortable: true,
					render: (record: Position) => (
						<LiquidityDataPositionWrapper data={record}>
							{({ currencyA, currencyB, tokenAAmount, tokenBAmount }) => (
								<Stack gap={2}>
									<Text fw="bold">
										<TokenPrice
											addresses={
												currencyA && currencyB
													? {
															[currencyA?.address]:
																tokenAAmount?.toNumber() || 0,
															[currencyB?.address]:
																tokenBAmount?.toNumber() || 0,
														}
													: {}
											}
											prefix="$"
											decimalScale={2}
										/>
									</Text>
									<Stack gap={0}>
										<Text fz="xs" fw="bold" lh={1} c="gray">
											<TokenBalance
												key={currencyA?.address}
												value={tokenAAmount?.toSignificantDigits(6).toString()}
												loading={false}
												decimalScale={5}
											/>
											<Text span c="gray.9" inherit ml={5}>
												{currencyA?.symbol}
											</Text>
										</Text>
										<Text fz="xs" fw="bold" lh={1} c="gray">
											<TokenBalance
												key={currencyB?.address}
												value={tokenBAmount?.toSignificantDigits(6).toString()}
												loading={false}
												decimalScale={5}
												prefix=""
											/>
											<Text span c="gray.9" inherit ml={5}>
												{currencyB?.symbol}
											</Text>
										</Text>
									</Stack>
								</Stack>
							)}
						</LiquidityDataPositionWrapper>
					),
				},
				{
					accessor: "reward.usd",
					title: i18n._("Rewards"),
					sortable: true,
					render: (record: Position) => (
						<LiquidityRewardFee positionId={record.getAddress().toString()} />
					),
				},
				...(hasIncentives ? [{
					accessor: "bonus",
					title: i18n._("veSOLV3 bonus"),
					render: (record: Position) => (
						<PositionBonusCredit poolAddress={record.getData().solve.toString()} />
					),
				}] : []),
				{
					accessor: "status",
					title: i18n._("Status"),
					sortable: true,
					width: 200,
					render: (record: Position) => (
						<LiquidityDataPositionWrapper data={record}>
							{({ outOfRange }) => (
								<Badge
									variant="outline"
									radius="sm"
									color={outOfRange ? "error.8" : "success.8"}
									p={10}
									tt="capitalize"
								>
									{outOfRange ? i18n._("Inactive") : i18n._("Active")}
								</Badge>
							)}
						</LiquidityDataPositionWrapper>
					),
				},
				{
					accessor: "action",
					title: "",
					width: 160,
					render: (record: Position) => (
						<Button
							size="lg"
							component={Link}
							href={`/liquidity/manager?positionId=${record.getAddress().toString()}`}
							variant="filled"
						>
							{i18n._("Manage")}
						</Button>
					),
				},
			]}
			sortStatus={sortStatus}
			onSortStatusChange={setSortStatus}
		/>
		)}
		</>
	);
};
