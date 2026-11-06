"use client";

import {
	Alert,
	Badge,
	Box,
	Button,
	Divider,
	Group,
	Modal,
	NumberInput,
	Paper,
	ScrollArea,
	SimpleGrid,
	Stack,
	Table,
	Text,
	ThemeIcon,
	Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
	IconAlertTriangle,
	IconShieldLock,
	IconWand,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import { useMemo, useState } from "react";
import { HIDDEN_POOL_ADDRESSES } from "@/configs/hiddenPools";
import { SOLVE } from "@/configs/tokens";
import { useProtocolAdmin } from "@/hooks/useProtocolAdmin";
import { useAllTokens } from "@/hooks/useToken";
import {
	getEpochPDA,
	getProtocolPDA,
	getVaultPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import {
	deriveDevnetPrices,
	type PricingPool,
	valueTokenAmounts,
} from "@/lib/devnetPricing";
import {
	formatAddress,
	formatPercentage,
	formatTokenAmount,
} from "@/lib/format";
import { useCluster } from "@/providers/ClusterProvider";
import { useAnchor } from "@/providers/DappProvider";
import { useLockData } from "@/stores/lock/hooks/useLockData";
import { usePools } from "@/stores/pool/hooks/usePools";
import type { VoteInfo, VotePerGauge } from "@/stores/vote/hooks/useVotes";
import { useVote, useVoteActions } from "@/stores/vote/VoteProvider";
import { optimizeVoteAllocation } from "@/utils/voteOptimizer";
import classes from "./VoteOptimizer.module.css";

const COLORS = ["violet.6", "cyan.6", "orange.6", "pink.6", "teal.6", "blue.6"];

type RewardToken = { mint: string; amount: number };

export const VoteOptimizer: React.FC = () => {
	const [opened, { open, close }] = useDisclosure(false);
	const { isAdmin, isLoading: adminLoading } = useProtocolAdmin();
	const { network } = useCluster();
	const { connection } = useAnchor();
	const program = useVesolveProgram();
	const lockId = useVote((state) => state.lockId);
	const { resetVoteState, setVoteState } = useVoteActions();
	const { data: lock } = useLockData(lockId);
	const [powerOverride, setPowerOverride] = useState<number | null>(null);
	const [rewardOverrides, setRewardOverrides] = useState<
		Record<string, number>
	>({});

	const chainQuery = useQuery({
		queryKey: ["admin-vote-optimizer", network],
		queryFn: async () => {
			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(protocolAddress);
			const epochNumber = protocol.currentEpoch.toNumber();
			const [epochAddress] = getEpochPDA(epochNumber);
			const [epoch, gauges] = await Promise.all([
				vesolveAccount.epoch(program).fetch(epochAddress),
				vesolveAccount.gauge(program).all(),
			]);
			const activeGauges = gauges.filter(
				({ account }) => account.status === 1 || account.status === 2,
			);
			const mintAddresses = new Set<string>();
			for (const { account } of activeGauges) {
				mintAddresses.add(account.tokenMintA.toString());
				mintAddresses.add(account.tokenMintB.toString());
			}
			for (const bribe of epoch.bribes)
				mintAddresses.add(bribe.tokenMint.toString());

			const decimals = new Map<string, number>();
			await Promise.all(
				Array.from(mintAddresses).map(async (address) => {
					const mint = await getMint(connection, new PublicKey(address)).catch(
						() => null,
					);
					decimals.set(address, mint?.decimals ?? 9);
				}),
			);

			const rows = await Promise.all(
				activeGauges.map(async ({ publicKey: gauge, account }) => {
					const [vaultAddress] = getVaultPDA(epochNumber, gauge);
					const vault = await vesolveAccount
						.vault(program)
						.fetchNullable(vaultAddress);
					const rewardTokens = new Map<string, number>();
					const addReward = (mint: string, rawAmount: BN) => {
						const amount =
							Number(rawAmount.toString()) / 10 ** (decimals.get(mint) ?? 9);
						rewardTokens.set(mint, (rewardTokens.get(mint) ?? 0) + amount);
					};

					if (vault) {
						addReward(account.tokenMintA.toString(), vault.poolRewardsA);
						addReward(account.tokenMintB.toString(), vault.poolRewardsB);
					}
					for (const bribe of epoch.bribes.filter((item) =>
						item.gauge.equals(gauge),
					)) {
						addReward(bribe.tokenMint.toString(), bribe.amount);
					}

					const gaugeWeight = epoch.gaugeWeights.find((item) =>
						item.gauge.equals(gauge),
					);
					return {
						gauge,
						poolAddress: account.poolAddress,
						feeTier: account.feeTier,
						existingVotingPower:
							Number(gaugeWeight?.weight.toString() ?? 0) / 1e9,
						rewardTokens: Array.from(
							rewardTokens,
							([mint, amount]): RewardToken => ({ mint, amount }),
						),
					};
				}),
			);

			return { epoch, epochNumber, rows };
		},
		enabled: isAdmin && opened,
		staleTime: 30_000,
	});

	// Same orphaned/hidden pools excluded from the Liquidity page and Vote
	// list — see HIDDEN_POOL_ADDRESSES. Dropped entirely here, not just from
	// the pool-metadata fetch below, so they never appear in the optimizer.
	const visibleChainRows = chainQuery.data?.rows.filter(
		(row) => !HIDDEN_POOL_ADDRESSES.has(row.poolAddress.toString()),
	);
	const poolAddresses = visibleChainRows?.map((row) =>
		row.poolAddress.toString(),
	);
	const { data: pools, isLoading: poolsLoading } = usePools(
		network,
		poolAddresses,
	);
	const tokenMap = useAllTokens();
	// pool.getTokenAInfo()/getTokenBInfo() only carry the mint address —
	// symbol/name come from the token registry, same fix as VoteLists.tsx
	// and BribesPool.tsx.
	const resolveTokenDisplay = (mint: string) =>
		tokenMap[mint] ?? {
			chainId: 0,
			address: mint,
			symbol: `${mint.slice(0, 4)}…`,
			name: mint,
			decimals: 0,
		};
	// No USDC route exists on devnet for these test assets (see the alert
	// below), so reward value is instead derived from the gauge pools'
	// actual spot prices/reserves, anchored on SOLV3 rather than USDC —
	// nearly every gauge here is already paired directly against SOLV3.
	// This drives real marginal-ROI ranking instead of falling back to an
	// even split whenever no dollar price is available.
	const pricingPools = useMemo<PricingPool[]>(
		() =>
			(pools ?? []).map((pool) => ({
				address: pool.getAddress().toString(),
				mintA: pool.getTokenAInfo().mint.toString(),
				mintB: pool.getTokenBInfo().mint.toString(),
				decimalsA: pool.getTokenAInfo().decimals,
				decimalsB: pool.getTokenBInfo().decimals,
				sqrtPrice: pool.getData().sqrtPrice.toString(),
				liquidity: pool.getData().liquidity.toString(),
				amountA: pool.getTokenVaultAInfo().amount.toString(),
				amountB: pool.getTokenVaultBInfo().amount.toString(),
			})),
		[pools],
	);
	const solv3Prices = useMemo(
		() => deriveDevnetPrices(pricingPools, SOLVE.address),
		[pricingPools],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: tokenMap/resolveTokenDisplay omitted below — see comment in the deps array
	const rows = useMemo(
		() =>
			(visibleChainRows ?? []).map((row) => {
				const pool = pools?.find((item) =>
					item.getAddress().equals(row.poolAddress),
				);
				const tokenA = pool
					? resolveTokenDisplay(pool.getTokenAInfo().address.toString())
					: null;
				const tokenB = pool
					? resolveTokenDisplay(pool.getTokenBInfo().address.toString())
					: null;
				const rewardValueSolv3 = valueTokenAmounts(
					Object.fromEntries(
						row.rewardTokens.map((reward) => [reward.mint, reward.amount]),
					),
					solv3Prices,
				).total.toNumber();
				return {
					...row,
					pool,
					tokenA,
					tokenB,
					name:
						tokenA && tokenB
							? `${tokenA.symbol}/${tokenB.symbol}`
							: `${row.poolAddress.toString().slice(0, 5)}…${row.poolAddress.toString().slice(-4)}`,
					liveRewardValueUsd: rewardValueSolv3,
					rewardValueUsd:
						rewardOverrides[row.gauge.toString()] ?? rewardValueSolv3,
				};
			}),
		// tokenMap/resolveTokenDisplay intentionally omitted: useAllTokens()
		// returns a new object reference every render, so depending on it
		// here would infinite-loop (see VoteLists.tsx for the same fix).
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[visibleChainRows, pools, rewardOverrides, solv3Prices],
	);

	const lockPower = lock ? Number(lock.lockPower.toString()) / 1e9 : 0;
	const modeledPower = powerOverride ?? lockPower;
	const recommendations = useMemo(
		() =>
			optimizeVoteAllocation(
				rows.map((row) => ({
					id: row.gauge.toString(),
					existingVotingPower: row.existingVotingPower,
					rewardValueUsd: row.rewardValueUsd,
				})),
				modeledPower,
			),
		[modeledPower, rows],
	);
	const totalEstimatedReward = recommendations.reduce(
		(sum, row) => sum + row.estimatedRewardUsd,
		0,
	);
	const hasLivePrices = rows.some((row) => row.liveRewardValueUsd > 0);
	const loading = chainQuery.isLoading || poolsLoading;
	const canApply =
		!loading &&
		modeledPower > 0 &&
		recommendations.some((row) => row.percent > 0) &&
		rows.every((row) => row.pool);

	const applyAllocation = () => {
		if (!chainQuery.data) return;
		resetVoteState();
		for (const recommendation of recommendations) {
			if (recommendation.percent <= 0) continue;
			const row = rows.find(
				(item) => item.gauge.toString() === recommendation.id,
			);
			if (!row?.pool || !row.tokenA || !row.tokenB) continue;
			const vote: VotePerGauge = {
				gauge: row.gauge,
				pool: row.poolAddress,
				bribesInfos: [],
				tradingFeesA: new BN(0),
				tradingFeesB: new BN(0),
			};
			const voteInfo = Object.assign(
				Object.create(Object.getPrototypeOf(row.pool)),
				row.pool,
				{
					tokenAInfo: row.tokenA,
					tokenBInfo: row.tokenB,
					feeTier: { fee: row.pool.getData().feeRate },
					vote,
					total: chainQuery.data.epoch.totalVotingPower,
					votes: new BN(Math.round(row.existingVotingPower * 1e9)),
				},
			) as VoteInfo;
			setVoteState(
				Object.assign(voteInfo, { votePercent: recommendation.percent }),
			);
		}
		close();
	};

	if (adminLoading || !isAdmin) return null;

	return (
		<>
			<Button size="lg" leftSection={<IconWand size={20} />} onClick={open}>
				Vote Optimizer
			</Button>
			<Modal opened={opened} onClose={close} size="xl" title={null} centered>
				<Stack gap="lg">
					<Group justify="space-between" align="flex-start">
						<Group align="flex-start">
							<ThemeIcon size={44} radius="md" variant="light" color="violet">
								<IconWand size={24} />
							</ThemeIcon>
							<Box>
								<Group gap="xs">
									<Title order={2}>Vote optimizer</Title>
									<Badge
										leftSection={<IconShieldLock size={11} />}
										color="violet"
										variant="light"
									>
										Admin
									</Badge>
								</Group>
								<Text c="dimmed" size="sm">
									Allocate one lock across gauges to maximize its estimated
									voter rewards.
								</Text>
							</Box>
						</Group>
						<Badge variant="outline">
							Epoch {chainQuery.data?.epochNumber ?? "—"}
						</Badge>
					</Group>

					<SimpleGrid cols={{ base: 1, sm: 3 }}>
						<Paper withBorder p="md" radius="md">
							<Text size="xs" c="dimmed" tt="uppercase" fw={700}>
								Selected lock
							</Text>
							<Text fw={700}>#{lockId || "—"}</Text>
						</Paper>
						<Paper withBorder p="md" radius="md">
							<NumberInput
								label="Modeled voting power"
								value={modeledPower}
								min={0}
								decimalScale={2}
								thousandSeparator=","
								onChange={(value) =>
									setPowerOverride(typeof value === "number" ? value : 0)
								}
							/>
						</Paper>
						<Paper withBorder p="md" radius="md">
							<Text size="xs" c="dimmed" tt="uppercase" fw={700}>
								Estimated return
							</Text>
							<Text fw={700} size="xl" className={classes.dataValue}>
								{totalEstimatedReward > 0
									? `${formatTokenAmount(totalEstimatedReward, { decimals: 2 })} SOLV3`
									: "No price"}
							</Text>
						</Paper>
					</SimpleGrid>

					{!loading && !hasLivePrices && (
						<Alert
							color="yellow"
							icon={<IconAlertTriangle size={18} />}
							title="Reward prices unavailable"
						>
							None of these gauges' reward tokens have a priced route through
							the pools shown, so they can't be valued in SOLV3 automatically.
							Enter comparable SOLV3 estimates below; until then the optimizer
							uses a neutral split.
						</Alert>
					)}

					<Box>
						<Group justify="space-between" mb="xs">
							<Text fw={700}>Recommended allocation</Text>
							<Text size="xs" c="dimmed">
								Fees + bribes · whole percentages
							</Text>
						</Group>
						<Box
							className={classes.allocationRail}
							aria-label="Recommended vote allocation"
						>
							{recommendations.map((item, index) => (
								<Box
									key={item.id}
									className={classes.allocationSegment}
									bg={COLORS[index % COLORS.length]}
									style={{ width: `${item.percent}%` }}
								/>
							))}
						</Box>
					</Box>

					<ScrollArea>
						<Table miw={760} verticalSpacing="sm">
							<Table.Thead>
								<Table.Tr>
									<Table.Th>Gauge</Table.Th>
									<Table.Th ta="right">Existing votes</Table.Th>
									<Table.Th ta="right">Reward value (SOLV3)</Table.Th>
									<Table.Th ta="right">Allocate</Table.Th>
									<Table.Th ta="right">Est. return</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{rows.map((row, index) => {
									const result = recommendations[index];
									return (
										<Table.Tr key={row.gauge.toString()}>
											<Table.Td>
												<Group gap="xs">
													<Box
														w={8}
														h={24}
														bg={COLORS[index % COLORS.length]}
														style={{ borderRadius: 99 }}
													/>
													<Stack gap={0}>
														<Text fw={700}>{row.name}</Text>
														<Text
															size="xs"
															c="dimmed"
															title={row.gauge.toString()}
														>
															{formatAddress(row.gauge.toString())}
														</Text>
													</Stack>
												</Group>
											</Table.Td>
											<Table.Td ta="right" className={classes.dataValue}>
												{formatTokenAmount(row.existingVotingPower)}
											</Table.Td>
											<Table.Td>
												<NumberInput
													className={classes.rewardInput}
													value={row.rewardValueUsd}
													min={0}
													decimalScale={2}
													suffix=" SOLV3"
													onChange={(value) =>
														setRewardOverrides((current) => ({
															...current,
															[row.gauge.toString()]:
																typeof value === "number" ? value : 0,
														}))
													}
												/>
											</Table.Td>
											<Table.Td ta="right">
												<Badge
													size="lg"
													variant="light"
													color={COLORS[index % COLORS.length].split(".")[0]}
												>
													{formatPercentage(result?.percent ?? 0)}
												</Badge>
											</Table.Td>
											<Table.Td ta="right" className={classes.dataValue}>
												{(result?.estimatedRewardUsd ?? 0) > 0
													? `${formatTokenAmount(result?.estimatedRewardUsd ?? 0, { decimals: 2 })} SOLV3`
													: "No price"}
											</Table.Td>
										</Table.Tr>
									);
								})}
							</Table.Tbody>
						</Table>
					</ScrollArea>

					<Divider />
					<Group justify="space-between">
						<Text size="xs" c="dimmed" maw={540}>
							Snapshot estimate only. Final rewards depend on votes cast after
							this calculation. Voter rewards become claimable when epoch{" "}
							{(chainQuery.data?.epochNumber ?? 0) + 1} begins.
						</Text>
						<Group>
							<Button variant="default" onClick={close}>
								Cancel
							</Button>
							<Button
								loading={loading}
								disabled={!canApply}
								onClick={applyAllocation}
							>
								Apply allocation
							</Button>
						</Group>
					</Group>
				</Stack>
			</Modal>
		</>
	);
};
