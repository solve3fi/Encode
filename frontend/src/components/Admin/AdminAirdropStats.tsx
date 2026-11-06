"use client";

import { useLingui } from "@lingui/react";
import { Avatar, Group, Progress, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { AIRDROP_PARTNER_META } from "@/configs/airdropPartners";
import { formatTokenAmount } from "@/lib/format";
import { CardLayout } from "../Layout/CardLayout";

type PartnerStat = {
	partner: string;
	budget: number;
	wallets: number;
	claimedWallets: number;
	allocatedRaw: string;
	claimedRaw: string;
	lockedRaw: string;
};

type PartnerStatsResponse = {
	partners: PartnerStat[];
	totalWallets: number;
	totalMinted: number;
	totalLocked: number;
	totalAllocatedRaw: string;
	totalClaimedRaw: string;
	totalLockedRaw: string;
};

const fromRaw = (raw: string): number => Number(BigInt(raw)) / 1_000_000_000;

export const AdminAirdropStats: React.FC = () => {
	const { i18n } = useLingui();

	const statsQuery = useQuery({
		queryKey: ["airdrop-partner-stats"],
		queryFn: async () => {
			const res = await fetch("/api/airdrop/partner-stats");
			if (!res.ok) throw new Error("Failed to load airdrop stats");
			return res.json() as Promise<PartnerStatsResponse>;
		},
	});

	const data = statsQuery.data;
	const totalAllocated = data ? fromRaw(data.totalAllocatedRaw) : 0;
	const totalClaimed = data ? fromRaw(data.totalClaimedRaw) : 0;

	return (
		<CardLayout>
			<Stack gap="md">
				<Group justify="space-between" align="baseline">
					<Text fz="lg" fw="bold">
						{i18n._("Airdrop Allocations")}
					</Text>
					{data && (
						<Text fz="sm" c="gray">
							{i18n._("{claimed} / {allocated} SOLV3 claimed across {wallets} wallets", {
								claimed: formatTokenAmount(totalClaimed, { decimals: 0 }),
								allocated: formatTokenAmount(totalAllocated, { decimals: 0 }),
								wallets: data.totalWallets,
							})}
						</Text>
					)}
				</Group>
				<Table.ScrollContainer minWidth={720}>
					<Table verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>{i18n._("Partner")}</Table.Th>
								<Table.Th>{i18n._("Allocated")}</Table.Th>
								<Table.Th>{i18n._("Claimed")}</Table.Th>
								<Table.Th>{i18n._("Locked")}</Table.Th>
								<Table.Th>{i18n._("Wallets")}</Table.Th>
								<Table.Th>{i18n._("Progress")}</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{!data && (
								<Table.Tr>
									<Table.Td colSpan={6}>
										<Text c="gray" ta="center" py="md">
											{statsQuery.isLoading ? i18n._("Loading…") : i18n._("Failed to load")}
										</Text>
									</Table.Td>
								</Table.Tr>
							)}
							{data?.partners.map((row) => {
								const allocated = fromRaw(row.allocatedRaw);
								const claimed = fromRaw(row.claimedRaw);
								const locked = fromRaw(row.lockedRaw);
								const claimedPct = allocated > 0 ? (claimed / allocated) * 100 : 0;
								const meta = AIRDROP_PARTNER_META[row.partner];
								return (
									<Table.Tr key={row.partner}>
										<Table.Td>
											<Group gap="sm">
												{meta && <Avatar src={meta.logo} size={24} radius="xl" />}
												<Text fw={600}>{row.partner}</Text>
											</Group>
										</Table.Td>
										<Table.Td>
											<Text data-numeric="true">
												{formatTokenAmount(allocated, { decimals: 0 })}
											</Text>
											{allocated !== row.budget && (
												<Text fz="xs" c="orange">
													{i18n._("budget {budget}", { budget: row.budget.toLocaleString() })}
												</Text>
											)}
										</Table.Td>
										<Table.Td>
											<Text data-numeric="true">
												{formatTokenAmount(claimed, { decimals: 0 })}
											</Text>
										</Table.Td>
										<Table.Td>
											<Text data-numeric="true">
												{formatTokenAmount(locked, { decimals: 0 })}
											</Text>
										</Table.Td>
										<Table.Td>
											<Text fz="sm">
												{i18n._("{claimed} / {total}", {
													claimed: row.claimedWallets,
													total: row.wallets,
												})}
											</Text>
										</Table.Td>
										<Table.Td miw={140}>
											<Group gap={6} wrap="nowrap">
												<Progress value={claimedPct} size="sm" style={{ flex: 1 }} />
												<Text fz="xs" c="gray" w={40}>
													{claimedPct.toFixed(0)}%
												</Text>
											</Group>
										</Table.Td>
									</Table.Tr>
								);
							})}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
				<Text c="gray" fz="xs">
					{i18n._(
						"\"Allocated\" is summed from the live claim ledger, not the fixed partner budget -- a partner with no activated snapshot yet (e.g. a newly split partner) shows zero until an upload is activated. \"Claimed\" and \"Locked\" reflect wallets that have minted and permanently locked their SOLV3, respectively.",
					)}
				</Text>
			</Stack>
		</CardLayout>
	);
};
