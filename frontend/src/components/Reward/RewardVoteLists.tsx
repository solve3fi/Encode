"use client";

import { useLingui } from "@lingui/react";
import {
	Avatar,
	Button,
	em,
	Group,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useWallet } from "@solana/wallet-adapter-react";
import { DataTable } from "mantine-datatable";
import Link from "next/link";
import { useAllTokens } from "@/hooks/useToken";
import {
	type ClaimableVoteReward,
	useVoteRewards,
} from "@/hooks/useVoteRewards";
import { useClaimVoteReward } from "@/hooks/useClaimVoteRewards";
import { formatTokenAmount } from "@/lib/format";
import { useReward } from "@/stores/reward/RewardProvider";
import { CurrencyLogo } from "../Token/CurrencyLogo";
import { RewardVoteListsMobile } from "./RewardVoteListsMobile";

export const toNumber = (
	raw: { toString(): string },
	decimals: number,
): number => Number(raw.toString()) / 10 ** decimals;

export const RewardVoteLists: React.FC = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const tokenMap = useAllTokens();
	const filter = useReward((state) => state.filter);
	const { data: rows, isLoading } = useVoteRewards();
	const { mutate: claim, isPending, variables } = useClaimVoteReward();
	// Same breakpoint RewardWrapper already splits this page's filter bar on,
	// and the one VoteLists uses to fall back to cards.
	const isNarrow = useMediaQuery(`(max-width: ${em(1024)})`);

	const filteredRows = (rows ?? []).filter((record) => {
		const query = filter.trim().toLowerCase();
		if (!query) return true;
		const symbolA = tokenMap[record.tokenMintA.toString()]?.symbol ?? "";
		const symbolB = tokenMap[record.tokenMintB.toString()]?.symbol ?? "";
		return `${symbolA}/${symbolB}`.toLowerCase().includes(query);
	});

	if (!publicKey) {
		return (
			<Paper p="xl" radius="md" withBorder>
				<Text c="dimmed">{i18n._("Connect your wallet to see voting rewards.")}</Text>
			</Paper>
		);
	}

	if (!isLoading && (rows ?? []).length === 0) {
		return (
			<Paper p="xl" radius="md" withBorder>
				<Stack align="flex-start" gap="sm">
					<Stack gap={4}>
						<Text fw={700}>{i18n._("No claimable voting rewards")}</Text>
						<Text c="dimmed">
							{i18n._(
								"Vote with a veSOLV3 lock to start earning a share of each gauge's bribes and swept trading fees.",
							)}
						</Text>
					</Stack>
					<Button component={Link} href="/arena">
						{i18n._("Go to Vote")}
					</Button>
				</Stack>
			</Paper>
		);
	}

	if (isNarrow) {
		return (
			<RewardVoteListsMobile
				records={filteredRows}
				publicKey={publicKey}
				pendingKey={isPending ? variables?.row.key : undefined}
				onClaim={(record) =>
					publicKey && claim({ user: publicKey, row: record })
				}
			/>
		);
	}

	return (
		<Stack gap="md">
			<DataTable
				withTableBorder={false}
				withColumnBorders={false}
				withRowBorders={false}
				verticalSpacing="md"
				miw={760}
				records={filteredRows}
				fetching={isLoading}
				minHeight={150}
				idAccessor={(record: ClaimableVoteReward) => record.key}
				columns={[
					{
						accessor: "pair",
						title: i18n._("Gauge"),
						width: 240,
						render: (record: ClaimableVoteReward) => {
							const currencyA = tokenMap[record.tokenMintA.toString()];
							const currencyB = tokenMap[record.tokenMintB.toString()];
							return (
								<Group gap={10}>
									<Avatar.Group>
										<CurrencyLogo currency={currencyA} size={32} />
										<CurrencyLogo currency={currencyB} size={32} />
									</Avatar.Group>
									<Stack gap={0}>
										<Text fw="bold">
											{`${currencyA?.symbol ?? "?"}/${currencyB?.symbol ?? "?"}`}
										</Text>
										<Text size="xs" c="gray">
											{i18n._("Epoch {epoch}", { epoch: record.epoch })}
										</Text>
									</Stack>
								</Group>
							);
						},
					},
					{
						accessor: "emission",
						title: i18n._("Voting Emission"),
						render: (record: ClaimableVoteReward) => {
							const rewardToken = tokenMap[record.rewardMint.toString()];
							if (!record.rewardAmount.gtn(0)) return <Text c="gray">—</Text>;
							return (
								<Text fw="bold">
									{formatTokenAmount(
										toNumber(record.rewardAmount, rewardToken?.decimals ?? 9),
										{ decimals: 4 },
									)}{" "}
									{rewardToken?.symbol ?? "SOLV3"}
								</Text>
							);
						},
					},
					{
						accessor: "fees",
						title: i18n._("Swept Trading Fees"),
						render: (record: ClaimableVoteReward) => {
							const currencyA = tokenMap[record.tokenMintA.toString()];
							const currencyB = tokenMap[record.tokenMintB.toString()];
							if (!record.poolRewardAmountA.gtn(0) && !record.poolRewardAmountB.gtn(0)) {
								return <Text c="gray">—</Text>;
							}
							return (
								<Stack gap={0}>
									{record.poolRewardAmountA.gtn(0) && (
										<Text size="xs" fw={600}>
											{formatTokenAmount(
												toNumber(record.poolRewardAmountA, currencyA?.decimals ?? 9),
												{ decimals: 4 },
											)}{" "}
											{currencyA?.symbol}
										</Text>
									)}
									{record.poolRewardAmountB.gtn(0) && (
										<Text size="xs" fw={600}>
											{formatTokenAmount(
												toNumber(record.poolRewardAmountB, currencyB?.decimals ?? 9),
												{ decimals: 4 },
											)}{" "}
											{currencyB?.symbol}
										</Text>
									)}
								</Stack>
							);
						},
					},
					{
						accessor: "bribes",
						title: i18n._("Bribes"),
						render: (record: ClaimableVoteReward) => {
							if (record.bribes.length === 0) return <Text c="gray">—</Text>;
							return (
								<Stack gap={0}>
									{record.bribes.map((bribe) => {
										const token = tokenMap[bribe.mint.toString()];
										return (
											<Text size="xs" fw={600} key={bribe.mint.toString()}>
												{formatTokenAmount(
													toNumber(bribe.amount, token?.decimals ?? 9),
													{ decimals: 4 },
												)}{" "}
												{token?.symbol ?? "?"}
											</Text>
										);
									})}
								</Stack>
							);
						},
					},
					{
						accessor: "action",
						title: "",
						width: 160,
						render: (record: ClaimableVoteReward) => (
							<Stack gap={4} align="flex-start">
								<Button
									size="lg"
									variant="filled"
									loading={isPending && variables?.row.key === record.key}
									onClick={() =>
										publicKey && claim({ user: publicKey, row: record })
									}
								>
									{i18n._("Claim")}
								</Button>
								{record.autoVoteFeeBps > 0 && (
									<Text size="xs" c="dimmed">
										{i18n._("Fees and bribes shown after the {pct}% Auto-Vote fee", {
											pct: record.autoVoteFeeBps / 100,
										})}
									</Text>
								)}
							</Stack>
						),
					},
				]}
			/>
		</Stack>
	);
};
