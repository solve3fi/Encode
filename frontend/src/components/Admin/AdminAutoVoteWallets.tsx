"use client";

import { useLingui } from "@lingui/react";
import {
	ActionIcon,
	Badge,
	Button,
	Group,
	NumberInput,
	PasswordInput,
	Select,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { notification } from "@/components/Notifications";
import type {
	AdminAutoVoteWalletPublic,
	AutoVotePoolAllocation,
} from "@/configs/autoVoteWallets";
import {
	AUTO_VOTE_WALLET_ADD_ACTION,
	AUTO_VOTE_WALLET_REMOVE_ACTION,
	AUTO_VOTE_WALLET_UPDATE_ACTION,
} from "@/configs/autoVoteWallets";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useAllTokens } from "@/hooks/useToken";
import { formatAddress } from "@/lib/format";
import { useCluster } from "@/providers/ClusterProvider";
import { usePools } from "@/stores/pool/hooks/usePools";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { useVotes } from "@/stores/vote/hooks/useVotes";
import { CardLayout } from "../Layout/CardLayout";

type AdminAutoVoteWalletsPublicById = Record<string, AdminAutoVoteWalletPublic>;
type PoolRow = { id: string; poolAddress: string; percent: number };

let rowIdCounter = 0;
const emptyRow = (): PoolRow => ({
	id: `row-${++rowIdCounter}`,
	poolAddress: "",
	percent: 0,
});

export const AdminAutoVoteWallets: React.FC = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { sign } = useAdminAuth();
	const queryClient = useQueryClient();
	const tokenMap = useAllTokens();

	const { data: voteConfig } = useVoteConfig(network);
	const { data: votes } = useVotes(network, voteConfig?.epoch.toNumber() || 0);
	const { data: pools } = usePools(
		network,
		votes?.map((item) => item.pool.toBase58()) || [],
	);
	const poolOptions = useMemo(
		() =>
			(pools ?? []).map((pool) => {
				const data = pool.getData();
				const symbolA = tokenMap[data.tokenMintA.toBase58()]?.symbol ?? "?";
				const symbolB = tokenMap[data.tokenMintB.toBase58()]?.symbol ?? "?";
				return {
					value: pool.getAddress().toString(),
					label: `${symbolA}/${symbolB} — ${formatAddress(pool.getAddress().toString())}`,
				};
			}),
		[pools, tokenMap],
	);

	const walletsQuery = useQuery({
		queryKey: ["admin-auto-vote-wallets"],
		queryFn: async () => {
			const res = await fetch("/api/admin/auto-vote-wallets");
			if (!res.ok) throw new Error("Failed to load");
			return res.json() as Promise<AdminAutoVoteWalletsPublicById>;
		},
	});

	const [secretKey, setSecretKey] = useState("");
	const [label, setLabel] = useState("");
	const [rows, setRows] = useState<PoolRow[]>([emptyRow()]);
	const [editingPubkey, setEditingPubkey] = useState<string | null>(null);

	const resetForm = () => {
		setSecretKey("");
		setLabel("");
		setRows([emptyRow()]);
		setEditingPubkey(null);
	};

	const setRow = (index: number, patch: Partial<PoolRow>) => {
		setRows((prev) =>
			prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
		);
	};

	const validRows = (): AutoVotePoolAllocation[] =>
		rows
			.filter((row) => row.poolAddress && row.percent > 0)
			.map((row) => ({ poolAddress: row.poolAddress, percent: row.percent }));

	const addMutation = useMutation({
		mutationFn: async () => {
			const pool_allocations = validRows();
			const { wallet, message, signature } = await sign(
				AUTO_VOTE_WALLET_ADD_ACTION,
				{ secretKey, label, pools: pool_allocations },
			);
			const res = await fetch("/api/admin/auto-vote-wallets", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					wallet,
					message,
					signature,
					secretKey,
					label,
					pools: pool_allocations,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Save failed");
			return data as { wallet: AdminAutoVoteWalletPublic };
		},
		onSuccess: ({ wallet }) => {
			queryClient.setQueryData<AdminAutoVoteWalletsPublicById>(
				["admin-auto-vote-wallets"],
				(prev) => ({ ...prev, [wallet.pubkey]: wallet }),
			);
			notification.success({
				title: i18n._("Auto-Vote Wallets"),
				message: i18n._("Wallet added"),
			});
			resetForm();
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Auto-Vote Wallets"),
				message: error.message,
			});
		},
	});

	const updateMutation = useMutation({
		mutationFn: async () => {
			if (!editingPubkey) throw new Error("Nothing to update");
			const pool_allocations = validRows();
			const { wallet, message, signature } = await sign(
				AUTO_VOTE_WALLET_UPDATE_ACTION,
				{ pubkey: editingPubkey, label: label ?? "", pools: pool_allocations },
			);
			const res = await fetch("/api/admin/auto-vote-wallets", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					wallet,
					message,
					signature,
					pubkey: editingPubkey,
					label,
					pools: pool_allocations,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Save failed");
			return data as { wallet: AdminAutoVoteWalletPublic };
		},
		onSuccess: ({ wallet }) => {
			queryClient.setQueryData<AdminAutoVoteWalletsPublicById>(
				["admin-auto-vote-wallets"],
				(prev) => ({ ...prev, [wallet.pubkey]: wallet }),
			);
			notification.success({
				title: i18n._("Auto-Vote Wallets"),
				message: i18n._("Pool allocation updated"),
			});
			resetForm();
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Auto-Vote Wallets"),
				message: error.message,
			});
		},
	});

	const removeMutation = useMutation({
		mutationFn: async (pubkey: string) => {
			const { wallet, message, signature } = await sign(
				AUTO_VOTE_WALLET_REMOVE_ACTION,
				{ pubkey },
			);
			const res = await fetch("/api/admin/auto-vote-wallets", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, message, signature, pubkey }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Remove failed");
			return pubkey;
		},
		onSuccess: (pubkey) => {
			queryClient.setQueryData<AdminAutoVoteWalletsPublicById>(
				["admin-auto-vote-wallets"],
				(prev) => {
					const next = { ...prev };
					delete next[pubkey];
					return next;
				},
			);
			notification.success({
				title: i18n._("Auto-Vote Wallets"),
				message: i18n._("Wallet removed"),
			});
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Auto-Vote Wallets"),
				message: error.message,
			});
		},
	});

	const startEdit = (wallet: AdminAutoVoteWalletPublic) => {
		setEditingPubkey(wallet.pubkey);
		setLabel(wallet.label);
		setRows(
			wallet.pools.length > 0
				? wallet.pools.map((pool) => ({ ...pool, id: `row-${++rowIdCounter}` }))
				: [emptyRow()],
		);
	};

	const records = Object.values(walletsQuery.data ?? {}).sort(
		(a, b) => b.addedAt - a.addedAt,
	);

	const totalPercent = validRows().reduce((sum, row) => sum + row.percent, 0);
	const isEditing = editingPubkey !== null;
	const isPending = addMutation.isPending || updateMutation.isPending;

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Admin Auto-Vote Wallets")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Wallets configured here automatically vote the chosen pools before every epoch ends, run by a server-side keeper. Secret keys are encrypted at rest and never shown again after saving.",
					)}
				</Text>

				{!isEditing && (
					<PasswordInput
						label={i18n._("Wallet secret key")}
						description={i18n._(
							"Paste a base58 secret key or a JSON byte-array keypair. This wallet must hold a veSOLV3 lock to vote with.",
						)}
						placeholder="[12,34,...] or base58 string"
						value={secretKey}
						onChange={(event) => setSecretKey(event.currentTarget.value)}
					/>
				)}
				<TextInput
					label={i18n._("Label")}
					placeholder={i18n._("e.g. Treasury wallet 1")}
					value={label}
					onChange={(event) => setLabel(event.currentTarget.value)}
				/>

				<Stack gap="xs">
					<Text fz="sm" fw="bold">
						{i18n._("Pool allocation")}
					</Text>
					{rows.map((row, index) => (
						<Group key={row.id} align="flex-end" gap="sm" wrap="wrap">
							<Select
								label={index === 0 ? i18n._("Pool") : undefined}
								placeholder={i18n._("Select a pool…")}
								data={poolOptions}
								value={row.poolAddress || null}
								onChange={(value) =>
									setRow(index, { poolAddress: value ?? "" })
								}
								searchable
								flex={1}
								miw={220}
							/>
							<NumberInput
								label={index === 0 ? i18n._("Percent") : undefined}
								min={0}
								max={100}
								value={row.percent || ""}
								onChange={(value) =>
									setRow(index, { percent: Number(value) || 0 })
								}
								w={100}
							/>
							<ActionIcon
								color="red"
								variant="light"
								mb={index === 0 ? 0 : 2}
								onClick={() =>
									setRows((prev) =>
										prev.length > 1
											? prev.filter((_, i) => i !== index)
											: [emptyRow()],
									)
								}
							>
								<IconTrash size={16} />
							</ActionIcon>
						</Group>
					))}
					<Group justify="space-between">
						<Button
							variant="light"
							size="xs"
							onClick={() => setRows((prev) => [...prev, emptyRow()])}
						>
							{i18n._("Add pool")}
						</Button>
						<Text fz="xs" c={totalPercent > 100 ? "red" : "gray"}>
							{i18n._("{total}% allocated", { total: totalPercent })}
						</Text>
					</Group>
				</Stack>

				<Group>
					{isEditing && (
						<Button variant="default" onClick={resetForm}>
							{i18n._("Cancel")}
						</Button>
					)}
					<Button
						loading={isPending}
						disabled={
							totalPercent <= 0 ||
							totalPercent > 100 ||
							(!isEditing && (!secretKey.trim() || !label.trim()))
						}
						onClick={() =>
							isEditing ? updateMutation.mutate() : addMutation.mutate()
						}
					>
						{isEditing ? i18n._("Save pool allocation") : i18n._("Add wallet")}
					</Button>
				</Group>

				<Table.ScrollContainer minWidth={720}>
					<Table verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>{i18n._("Wallet")}</Table.Th>
								<Table.Th>{i18n._("Pools")}</Table.Th>
								<Table.Th>{i18n._("Last vote")}</Table.Th>
								<Table.Th>{i18n._("Actions")}</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{records.length === 0 && (
								<Table.Tr>
									<Table.Td colSpan={4}>
										<Text c="gray" ta="center" py="md">
											{walletsQuery.isLoading
												? i18n._("Loading…")
												: i18n._("No auto-vote wallets configured yet")}
										</Text>
									</Table.Td>
								</Table.Tr>
							)}
							{records.map((wallet) => (
								<Table.Tr key={wallet.pubkey}>
									<Table.Td>
										<Stack gap={0}>
											<Text fw="bold">{wallet.label}</Text>
											<Text fz="xs" c="gray" ff="monospace">
												{formatAddress(wallet.pubkey)}
											</Text>
										</Stack>
									</Table.Td>
									<Table.Td>
										<Stack gap={2}>
											{wallet.pools.map((pool) => (
												<Text key={pool.poolAddress} fz="xs">
													{poolOptions.find((o) => o.value === pool.poolAddress)
														?.label ?? formatAddress(pool.poolAddress)}{" "}
													— {pool.percent}%
												</Text>
											))}
										</Stack>
									</Table.Td>
									<Table.Td>
										{wallet.lastError ? (
											<Badge color="red" variant="light">
												{i18n._("Error")}
											</Badge>
										) : wallet.lastVotedEpoch !== undefined ? (
											<Stack gap={0}>
												<Badge color="green" variant="light">
													{i18n._("Epoch {epoch}", {
														epoch: wallet.lastVotedEpoch,
													})}
												</Badge>
											</Stack>
										) : (
											<Text fz="xs" c="gray">
												{i18n._("Not yet voted")}
											</Text>
										)}
										{wallet.lastError && (
											<Text fz="xs" c="red" truncate maw={200}>
												{wallet.lastError}
											</Text>
										)}
									</Table.Td>
									<Table.Td>
										<Group gap="xs">
											<Button
												size="xs"
												variant="light"
												onClick={() => startEdit(wallet)}
											>
												{i18n._("Edit pools")}
											</Button>
											<Button
												size="xs"
												variant="light"
												color="red"
												loading={
													removeMutation.isPending &&
													removeMutation.variables === wallet.pubkey
												}
												onClick={() => removeMutation.mutate(wallet.pubkey)}
											>
												{i18n._("Remove")}
											</Button>
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			</Stack>
		</CardLayout>
	);
};
