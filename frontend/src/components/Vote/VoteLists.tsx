"use client";

import { useLingui } from "@lingui/react";
import {
	Anchor,
	Avatar,
	Box,
	Divider,
	Group,
	SegmentedControl,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	IconChevronUp,
	IconLayoutGrid,
	IconLayoutList,
	IconSelector,
} from "@tabler/icons-react";
import sortBy from "lodash/sortBy";
import { useMediaQuery } from "@mantine/hooks";
import { DataTable, type DataTableSortStatus } from "mantine-datatable";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { notification } from "@/components/Notifications";
import { matchesPair, parseAllocParam } from "@/lib/command/plan";
import { AcceleratorBadge } from "@/components/Pool/AcceleratorBadge";
import { DataState } from "@/components/ProtocolStatus/DataState";
import { RewardEmissionApr } from "@/components/Reward/RewardEmissionApr";
import { useAcceleratedPools } from "@/hooks/useAcceleratedPools";
import { useAllTokens } from "@/hooks/useToken";
import { formatPercentage } from "@/lib/format";
import {
	gaugeVotingPower,
	votingPowerUnits,
	votingShare,
} from "@/lib/voteDisplay";
import { useCluster } from "@/providers/ClusterProvider";
import { usePools } from "@/stores/pool/hooks/usePools";
import { useUserVote } from "@/stores/vote/hooks/useUserVote";
import { useVote } from "@/stores/vote/hooks/useVote";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVoteEpochStats } from "@/stores/vote/hooks/useVoteEpochStats";
import { useVotes, type VoteInfo } from "@/stores/vote/hooks/useVotes";
import {
	useVoteActions,
	useVote as useVoteState,
} from "@/stores/vote/VoteProvider";
import { TokenBalance } from "../Token/TokenBalance";
import tableClasses from "./VoteLists.module.css";
import classes from "./Vote.module.css";
import { VoteListsMobile } from "./VoteListsMobile";
import { VotePercentHandle } from "./VotePercentHandle";
import { BribesReward, units, VoteReward } from "./VoteReward";

const usdValue = (
	breakdown: { address: string; price: number }[],
	mint: string,
	amount: { toString(): string },
	decimals: number,
) => {
	const price = breakdown.find((entry) => entry.address === mint)?.price ?? 0;
	if (price <= 0) return 0;
	return (Number(amount.toString()) / 10 ** decimals) * price;
};

export const VoteLists: React.FC = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const tokenMap = useAllTokens();
	const acceleratedPools = useAcceleratedPools(network);

	const { data: voteConfig, error: configError } = useVoteConfig(network);
	const {
		data: vote,
		isLoading: voteLoading,
		error: voteError,
		refetch: refreshVote,
	} = useVote(network, voteConfig?.epoch.toNumber() || 0);
	const {
		data: votes,
		isLoading: votesLoading,
		error: votesError,
		refetch: refreshVotes,
	} = useVotes(network, voteConfig?.epoch.toNumber() || 0);
	const {
		data: pools,
		isLoading: poolsLoading,
		error: poolsError,
	} = usePools(network, votes?.map((item) => item.pool.toBase58()) || []);

	// Same pricing this epoch's protocol-wide stats already derive (shared
	// TanStack Query cache — this doesn't add a second round of RPC/pricing
	// calls), reused here so every row's bribes/fees can be shown and sorted
	// as real numbers instead of only appearing inside VoteReward's popover.
	const { breakdown } = useVoteEpochStats(
		network,
		voteConfig?.epoch.toNumber() || 0,
		votes,
		undefined,
	);
	// useUSDCPrice's `breakdown` is a plain .flatMap() result, not memoized —
	// a new array reference every render even when prices haven't changed.
	// Depending on it directly in votesList's useMemo below reliably caused
	// "Maximum update depth exceeded" (same failure mode as the tokenMap
	// issue elsewhere in this file). Strings compare by value, so this key
	// only actually changes when the priced content changes.
	const priceKey = breakdown
		.map((entry) => `${entry.address}:${entry.price}`)
		.sort()
		.join(",");

	// pool.getTokenAInfo()/getTokenBInfo() return raw SPL mint account data
	// (decimals, supply, ...) — no symbol/logoURI. Prefer the token registry,
	// falling back to a truncated-address placeholder for unlisted mints
	// (mirrors the same fallback in useVotes.ts's bribesInfos resolution).
	const resolveTokenDisplay = (mint: string) =>
		tokenMap[mint] ?? {
			chainId: 0,
			address: mint,
			symbol: `${mint.slice(0, 4)}…`,
			name: mint,
			decimals: 0,
		};

	const votesList = useMemo(() => {
		// Hidden/orphaned pools are already excluded upstream by useVotes
		// (which useAllPools also shares HIDDEN_POOL_ADDRESSES with), so
		// `pools` here — derived from votes' addresses — never includes them.
		return pools?.map((pool) => {
			const poolData = pool.getData();
			const gaugeVote = votes?.find((item) =>
				item.pool.equals(pool.getAddress()),
			);
			const tokenAInfo = resolveTokenDisplay(poolData.tokenMintA.toBase58());
			const tokenBInfo = resolveTokenDisplay(poolData.tokenMintB.toBase58());
			const bribesUsd = (gaugeVote?.bribesInfos ?? []).reduce(
				(sum, bribe) =>
					sum +
					usdValue(
						breakdown,
						bribe.mint.toBase58(),
						bribe.vaultInfo.amount,
						bribe.mintInfo.decimals,
					),
				0,
			);
			const feesUsd =
				usdValue(breakdown, tokenAInfo.address, gaugeVote?.tradingFeesA ?? 0, tokenAInfo.decimals) +
				usdValue(breakdown, tokenBInfo.address, gaugeVote?.tradingFeesB ?? 0, tokenBInfo.decimals);
			const tvlUsd =
				usdValue(breakdown, tokenAInfo.address, pool.getTokenVaultAInfo().amount, tokenAInfo.decimals) +
				usdValue(breakdown, tokenBInfo.address, pool.getTokenVaultBInfo().amount, tokenBInfo.decimals);
			// Display metadata must not overwrite the SDK fields on the shared
			// query-cache pool used by TVL and gauge-fee calculations.
			return Object.assign(Object.create(Object.getPrototypeOf(pool)), pool, {
				tokenAInfo,
				tokenBInfo,
				feeTier: { fee: poolData.feeRate },
				vote: gaugeVote,
				total: vote?.votes,
				votes: gaugeVotingPower(vote, gaugeVote?.gauge),
				bribesUsd,
				feesUsd,
				rewardsUsd: bribesUsd + feesUsd,
				tvlUsd,
			});
		}) as unknown as VoteInfo[];
		// tokenMap and breakdown intentionally omitted: useAllTokens() and
		// useUSDCPrice()'s breakdown both return a new reference every render
		// (neither is memoized), so depending on either directly here caused
		// an infinite render loop. priceKey is a string derived from
		// breakdown's actual content, so it only changes — and only then
		// triggers a recompute, picking up the current `breakdown` closure —
		// when real price data changes, not on every render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pools, vote, votes, priceKey]);

	// Casting a vote replaces the user's ENTIRE allocation for the epoch (it's
	// one Vec<GaugeVote> field on-chain, not per-gauge storage), so any gauge
	// left out of a fresh vote() call silently loses its prior weight. Seed
	// the draft with what's already on-chain before the user edits anything,
	// so the running total and cap correctly account for existing votes
	// instead of a blank slate that lets a new 100% entry wipe them out.
	const { publicKey } = useWallet();
	const lockId = useVoteState((state) => state.lockId);
	const { data: userVote } = useUserVote(
		network,
		voteConfig?.epoch.toNumber() || 0,
		lockId,
	);
	const voteState = useVoteState((state) => state.voteState);
	const { setVoteState, resetVoteState } = useVoteActions();
	const hydratedFor = useRef<string | null>(null);
	const lockJustChanged = useRef(false);
	// Votes are per lock: switching lock drops the previous lock's draft so the
	// new lock's own on-chain vote can be loaded in its place.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the selected lock changes
	useEffect(() => {
		resetVoteState();
		hydratedFor.current = null;
		lockJustChanged.current = true;
	}, [lockId]);
	useEffect(() => {
		const key = `${network}:${publicKey?.toString() ?? ""}:${voteConfig?.epoch.toNumber() ?? 0}:${lockId}`;
		if (hydratedFor.current === key) return;
		// Undefined is still loading; null is a confirmed empty current-epoch
		// account. Mark both empty and populated results as hydrated so a later
		// poll cannot unexpectedly replace an in-progress draft.
		if (!votesList || userVote === undefined) return;
		hydratedFor.current = key;
		const draftIsStale = lockJustChanged.current;
		lockJustChanged.current = false;
		if (
			(voteState.length > 0 && !draftIsStale) ||
			!userVote ||
			userVote.votes.length === 0
		)
			return;
		// The record stores each gauge's share as voting power; the draft works
		// in whole percent of the lock's power.
		const totalPower = userVote.totalVotingPower.toNumber();
		if (totalPower <= 0) return;
		for (const { gauge, weight } of userVote.votes) {
			const match = votesList.find((item) => item.vote?.gauge.equals(gauge));
			if (match) {
				setVoteState(
					Object.assign(Object.create(Object.getPrototypeOf(match)), match, {
						votePercent: Math.round((weight.toNumber() * 100) / totalPower),
					}),
				);
			}
		}
	}, [
		votesList,
		userVote,
		voteState.length,
		publicKey,
		network,
		voteConfig,
		lockId,
		setVoteState,
	]);

	// Command bar prefill (/vote?alloc=sol/usdc:50,solv3/usdc:50). It waits until the selected lock's on-chain vote
	// has loaded so the hydration above cannot merge into it, then replaces the draft. Nothing is cast here: the
	// person reviews the allocation and presses Cast vote.
	const allocParam = useSearchParams().get("alloc");
	const prefilledFor = useRef<string | null>(null);
	useEffect(() => {
		if (!allocParam || !votesList || votesList.length === 0) return;
		if (publicKey && lockId && userVote === undefined) return;
		const key = `${allocParam}|${network}:${publicKey?.toString() ?? ""}:${lockId}`;
		if (prefilledFor.current === key) return;
		prefilledFor.current = key;
		const missing: string[] = [];
		resetVoteState();
		for (const { pool, percent } of parseAllocParam(allocParam)) {
			const match = votesList.find((item) =>
				matchesPair(pool, item.tokenAInfo.symbol, item.tokenBInfo.symbol),
			);
			if (match) {
				setVoteState(
					Object.assign(Object.create(Object.getPrototypeOf(match)), match, {
						votePercent: percent,
					}),
				);
			} else {
				missing.push(pool.toUpperCase());
			}
		}
		if (missing.length > 0) {
			notification.warning({
				title: i18n._("Some pools were not found"),
				message: i18n._("No active gauge for {pools}. Check the pool names.", {
					pools: missing.join(", "),
				}),
			});
		}
	}, [
		allocParam,
		votesList,
		publicKey,
		lockId,
		userVote,
		network,
		resetVoteState,
		setVoteState,
		i18n,
	]);

	const searchQuery = useVoteState((state) => state.searchQuery);
	const filteredVotesList = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return votesList;
		return votesList?.filter(({ tokenAInfo, tokenBInfo }) =>
			`${tokenAInfo.symbol}/${tokenBInfo.symbol}`.toLowerCase().includes(query),
		);
	}, [votesList, searchQuery]);

	const [sortStatus, setSortStatus] = useState<DataTableSortStatus<VoteInfo>>({
		columnAccessor: "votes",
		direction: "desc",
	});
	const [records, setRecords] = useState(
		sortBy(filteredVotesList, "tokenAInfo.address"),
	);

	// Defaults to table on desktop, cards on phone widths (matching the
	// pre-existing per-breakpoint split), but either can be chosen explicitly
	// at any width once the user picks a view.
	const [viewMode, setViewMode] = useState<"table" | "cards" | null>(null);
	// The wide table cannot fit a phone; it scrolls sideways and clips the pool
	// names, so phone widths always use cards and the view toggle is hidden.
	const isPhone = useMediaQuery("(max-width: 760px)") ?? false;
	const effectiveView = isPhone ? "cards" : (viewMode ?? "cards");

	useEffect(() => {
		const data =
			sortStatus.columnAccessor === "votes"
				? [...(filteredVotesList ?? [])].sort((a, b) => a.votes.cmp(b.votes))
				: (sortBy(filteredVotesList, sortStatus.columnAccessor) as VoteInfo[]);
		setRecords(sortStatus.direction === "desc" ? data.reverse() : data);
	}, [sortStatus, filteredVotesList]);

	const isLoading = !voteConfig || votesLoading || poolsLoading || voteLoading;
	if (configError || voteError || votesError || poolsError)
		return (
			<DataState
				kind="error"
				title={i18n._("Unable to load gauge votes and rewards")}
				description={i18n._(
					"Solana data could not be read. Missing data is not a zero vote or reward balance. Please retry.",
				)}
				actionLabel={i18n._("Retry")}
				onAction={() => {
					refreshVote();
					refreshVotes();
				}}
			/>
		);

	const columns = [
		{
			accessor: "pair.name",
			title: i18n._("Pool"),
			width: 210,
			render: (record: VoteInfo) => {
				const { tokenAInfo, tokenBInfo, feeTier } = record;
				const accelerated = acceleratedPools.get(
					record.getAddress().toString(),
				);
				return (
					<Group gap={8} pos="relative" wrap="nowrap">
						<Avatar.Group>
							<Avatar
								key={tokenAInfo.name}
								src={tokenAInfo.logoURI}
								title={tokenAInfo.name}
								size={28}
							/>
							<Avatar
								key={tokenBInfo.name}
								src={tokenBInfo.logoURI}
								title={tokenBInfo.name}
								size={28}
							/>
						</Avatar.Group>
						<Stack gap={0}>
							<Group gap={6}>
								<Text fw="bold">{`${tokenAInfo.symbol}/${tokenBInfo.symbol}`}</Text>
								{accelerated && <AcceleratorBadge info={accelerated} />}
							</Group>
							<Text size="xs" c="gray">
								{`${formatPercentage(feeTier.fee / 10_000)} ${i18n._("fee tier")}`}
							</Text>
							<Text size="xs" c="gray.6">
								{i18n._("TVL")}{" "}
								{record.tvlUsd > 0 ? (
									<TokenBalance value={record.tvlUsd} loading={false} prefix="$" />
								) : (
									"—"
								)}
							</Text>
						</Stack>
					</Group>
				);
			},
		},
		{
			accessor: "type.name",
			title: i18n._("APR"),
			width: 110,
			sortable: true,
			textAlign: "right" as const,
			render: (record: VoteInfo) => (
				<RewardEmissionApr poolAddress={record.getAddress().toString()} />
			),
		},
		{
			accessor: "votes",
			title: i18n._("Total Votes"),
			width: 120,
			sortable: true,
			textAlign: "right" as const,
			render: ({ votes, total }: VoteInfo) => (
				<Stack gap={0}>
					<Text fw="bold">
						<TokenBalance value={votingPowerUnits(votes)} loading={false} />
					</Text>
					<Text fz="sm" lh={1} c="gray.7">
						<TokenBalance
							value={votingShare(votes, total)}
							loading={false}
							decimalScale={2}
							suffix="%"
						/>
					</Text>
				</Stack>
			),
		},
		{
			accessor: "bribesUsd",
			title: i18n._("Incentives"),
			sortable: true,
			width: 130,
			textAlign: "right" as const,
			render: (record: VoteInfo) =>
				(record.vote?.bribesInfos.length ?? 0) === 0 ? (
					<Anchor
						component={Link}
						href={`/bribes?pool=${record.getAddress().toString()}`}
						size="sm"
						fw={600}
					>
						{i18n._("Add incentives")}
					</Anchor>
				) : (
					<Stack gap={4} align="flex-end">
						<Text fw="bold">
							{record.bribesUsd > 0 ? (
								<TokenBalance value={record.bribesUsd} loading={false} prefix="$" />
							) : (
								"—"
							)}
						</Text>
						<Divider w="100%" />
						<BribesReward data={record.vote?.bribesInfos ?? []} />
					</Stack>
				),
		},
		{
			accessor: "feesUsd",
			title: i18n._("Fees"),
			sortable: true,
			width: 140,
			textAlign: "right" as const,
			render: (record: VoteInfo) => {
				const feeA = units(record.vote?.tradingFeesA, record.tokenAInfo.decimals);
				const feeB = units(record.vote?.tradingFeesB, record.tokenBInfo.decimals);
				return (
					<Stack gap={4} align="flex-end">
						<Text fw="bold">
							{record.feesUsd > 0 ? (
								<TokenBalance value={record.feesUsd} loading={false} prefix="$" />
							) : (
								"—"
							)}
						</Text>
						<Divider w="100%" />
						<Stack gap={2} align="flex-end">
							<Text size="xs">{feeA.toLocaleString("en-US", { maximumFractionDigits: 9 })} {record.tokenAInfo.symbol}</Text>
							<Text size="xs">{feeB.toLocaleString("en-US", { maximumFractionDigits: 9 })} {record.tokenBInfo.symbol}</Text>
						</Stack>
					</Stack>
				);
			},
		},
		{
			accessor: "rewardsUsd",
			title: i18n._("Total Rewards"),
			sortable: true,
			width: 120,
			textAlign: "right" as const,
			render: (record: VoteInfo) => <VoteReward poolVote={record} />,
		},
		{
			accessor: "action",
			title: "Enter Vote",
			width: 260,
			render: (record: VoteInfo) => (
				<VotePercentHandle data={record} key={records.indexOf(record) + 1} />
			),
		},
	];

	const loadingOrEmpty = isLoading ? (
		<div className={classes.skeleton} role="status" aria-live="polite">
			<div className={classes.skelHead}>
				<span className={classes.ping} />
				<div>
					<strong>{i18n._("Reading gauge accounts")}</strong>
					<span>
						{i18n._(
							"Synchronizing the current epoch and pool vote weights from Solana.",
						)}
					</span>
				</div>
			</div>
			<div className={classes.skelRow} />
			<div className={classes.skelRow} />
			<div className={classes.skelRow} />
		</div>
	) : records.length === 0 ? (
		<DataState
			kind="empty"
			title={i18n._("No active gauges")}
			description={i18n._(
				"No pools are eligible for votes in this epoch. Check again after the next gauge activation.",
			)}
		/>
	) : null;

	return (
		<Stack gap="sm">
			<Group justify="space-between" wrap="wrap">
				{/* Card view has no clickable column headers, so this is the only
				sort control there — same sortStatus the table's headers drive. */}
				<Select
					size="sm"
					w={200}
					aria-label={i18n._("Sort gauges by")}
					value={sortStatus.columnAccessor}
					onChange={(value) =>
						value &&
						setSortStatus({
							columnAccessor: value,
							direction: "desc",
						})
					}
					data={[
						{ value: "tvlUsd", label: i18n._("Sort: Highest TVL") },
						{ value: "bribesUsd", label: i18n._("Sort: Most incentives") },
						{ value: "feesUsd", label: i18n._("Sort: Most fees") },
						{ value: "votes", label: i18n._("Sort: Most votes") },
						{ value: "rewardsUsd", label: i18n._("Sort: Most total rewards") },
						{ value: "type.name", label: i18n._("Sort: Highest APR") },
					]}
				/>
				{!isPhone && (
					<SegmentedControl
						size="sm"
						value={effectiveView}
						onChange={(value) => setViewMode(value as "table" | "cards")}
						data={[
							{
								value: "table",
								label: (
									<Group gap={6} wrap="nowrap" aria-label={i18n._("Table view")}>
										<IconLayoutList size={16} />
										<Box visibleFrom="sm">{i18n._("Table")}</Box>
									</Group>
								),
							},
							{
								value: "cards",
								label: (
									<Group gap={6} wrap="nowrap" aria-label={i18n._("Card view")}>
										<IconLayoutGrid size={16} />
										<Box visibleFrom="sm">{i18n._("Cards")}</Box>
									</Group>
								),
							},
						]}
					/>
				)}
			</Group>

			{loadingOrEmpty ??
				(effectiveView === "table" ? (
					<Box style={{ overflowX: "auto" }}>
						<DataTable
							withTableBorder={false}
							withColumnBorders={false}
							withRowBorders
							className={tableClasses.root}
							rowClassName={tableClasses.row}
							verticalSpacing="md"
							miw={950}
							records={records}
							columns={columns}
							sortStatus={sortStatus}
							onSortStatusChange={setSortStatus}
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
						/>
					</Box>
				) : (
					<VoteListsMobile records={records} />
				))}
		</Stack>
	);
};
