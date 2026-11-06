"use client";

import { useLingui } from "@lingui/react";
import {
	Alert,
	Badge,
	Button,
	Group,
	NumberInput,
	Select,
	Stack,
	Table,
	Text,
	TextInput,
	Title,
	Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconDownload } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { notification } from "@/components/Notifications";
import {
	DEFAULT_FEE_SHARE_BPS,
	DEFAULT_MULTIPLIER,
	LP_INCENTIVE_REMOVE_ACTION,
	LP_INCENTIVE_SET_ACTION,
	LP_INCENTIVE_SETTINGS_ACTION,
	LP_LEDGER_DOWNLOAD_ACTION,
	type LpIncentiveLedger,
	type LpIncentivePool,
	type LpIncentivesConfig,
	type LpIncentiveStatus,
} from "@/configs/lpIncentives";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useAllPools } from "@/hooks/useAllPools";
import { usePools } from "@/hooks/usePools";
import {
	LP_INCENTIVES_QUERY_KEY,
	LP_LEDGER_QUERY_KEY,
	useLpIncentiveLedger,
	useLpIncentivesConfig,
} from "@/hooks/useLpIncentives";
import { useAllTokens } from "@/hooks/useToken";
import { formatAddress, formatFiat } from "@/lib/format";
import { useSetProtocolFeeRate } from "@/stores/admin/hooks/useSetProtocolFeeRate";
import { CardLayout } from "../Layout/CardLayout";

const STATUS_COLORS: Record<LpIncentiveStatus, string> = {
	active: "success.8",
	paused: "yellow.7",
	ended: "gray.6",
};

const postAdmin = async (url: string, body: Record<string, unknown>) => {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error ?? "Request failed");
	return data;
};

/**
 * Soft-launch LP bootstrap: pick pools whose swap fees are partly kept by
 * the protocol (on-chain protocolFeeRate) and whose LPs are compensated in
 * veSOLV3 credit by scripts/lp-incentives-keeper.mjs. The config saved here
 * is the keeper's input; "Apply on-chain" signs the fee-rate change with the
 * DEX fee authority.
 */
export const AdminLpIncentives: React.FC = () => {
	const { i18n } = useLingui();
	const { sign } = useAdminAuth();
	const queryClient = useQueryClient();
	const tokenMap = useAllTokens();
	const { data: poolAddresses } = useAllPools();
	const { data: pools } = usePools(poolAddresses);
	const configQuery = useLpIncentivesConfig();
	const ledgerQuery = useLpIncentiveLedger();
	const setFeeRate = useSetProtocolFeeRate();

	const config = configQuery.data;
	const [poolAddress, setPoolAddress] = useState<string | null>(null);
	const [feeSharePct, setFeeSharePct] = useState<number | string>(DEFAULT_FEE_SHARE_BPS / 100);
	const [multiplier, setMultiplier] = useState<number | string>(DEFAULT_MULTIPLIER);
	const [weeklyCap, setWeeklyCap] = useState<number | string>("");
	const [notes, setNotes] = useState("");
	const [veSolv3Usd, setVeSolv3Usd] = useState<number | string>("");

	const poolLabel = (address: string) => {
		const pool = pools?.find((item) => item.getAddress().toString() === address);
		if (!pool) return formatAddress(address);
		const data = pool.getData();
		const symbolA = tokenMap[data.tokenMintA.toBase58()]?.symbol ?? "?";
		const symbolB = tokenMap[data.tokenMintB.toBase58()]?.symbol ?? "?";
		return `${symbolA}/${symbolB} · ${(data.feeRate / 10_000).toFixed(2)}%`;
	};
	const onChainRate = (address: string) =>
		pools?.find((item) => item.getAddress().toString() === address)?.getData().protocolFeeRate;

	const poolOptions = useMemo(
		() =>
			(pools ?? [])
				.filter((pool) => !config?.pools[pool.getAddress().toString()])
				.map((pool) => {
					const address = pool.getAddress().toString();
					const data = pool.getData();
					const symbolA = tokenMap[data.tokenMintA.toBase58()]?.symbol ?? "?";
					const symbolB = tokenMap[data.tokenMintB.toBase58()]?.symbol ?? "?";
					return {
						value: address,
						label: `${symbolA}/${symbolB} · ${(data.feeRate / 10_000).toFixed(2)}% — ${formatAddress(address)}`,
					};
				}),
		[pools, tokenMap, config],
	);

	const refresh = (next: LpIncentivesConfig) => {
		queryClient.setQueryData(LP_INCENTIVES_QUERY_KEY, next);
		queryClient.invalidateQueries({ queryKey: LP_LEDGER_QUERY_KEY });
	};
	const fail = (error: Error) =>
		notification.error({ title: i18n._("LP Incentives"), message: error.message });

	const saveMutation = useMutation({
		mutationFn: async (entry: Omit<LpIncentivePool, "updatedBy" | "updatedAt">) => {
			const payload = {
				poolAddress: entry.poolAddress,
				feeShareBps: entry.feeShareBps,
				multiplier: entry.multiplier,
				weeklyCapSolv3: entry.weeklyCapSolv3 ?? null,
				status: entry.status,
				notes: entry.notes ?? "",
			};
			const auth = await sign(LP_INCENTIVE_SET_ACTION, payload);
			return (await postAdmin("/api/admin/lp-incentives", {
				...auth,
				action: LP_INCENTIVE_SET_ACTION,
				...payload,
			})) as LpIncentivesConfig;
		},
		onSuccess: (next) => {
			refresh(next);
			notification.success({ title: i18n._("LP Incentives"), message: i18n._("Saved") });
			setPoolAddress(null);
			setNotes("");
		},
		onError: fail,
	});

	const removeMutation = useMutation({
		mutationFn: async (address: string) => {
			const auth = await sign(LP_INCENTIVE_REMOVE_ACTION, { poolAddress: address });
			return (await postAdmin("/api/admin/lp-incentives", {
				...auth,
				action: LP_INCENTIVE_REMOVE_ACTION,
				poolAddress: address,
			})) as LpIncentivesConfig;
		},
		onSuccess: refresh,
		onError: fail,
	});

	const settingsMutation = useMutation({
		mutationFn: async (price: number) => {
			const auth = await sign(LP_INCENTIVE_SETTINGS_ACTION, { veSolv3Usd: price });
			return (await postAdmin("/api/admin/lp-incentives", {
				...auth,
				action: LP_INCENTIVE_SETTINGS_ACTION,
				veSolv3Usd: price,
			})) as LpIncentivesConfig;
		},
		onSuccess: (next) => {
			refresh(next);
			setVeSolv3Usd("");
			notification.success({ title: i18n._("LP Incentives"), message: i18n._("veSOLV3 price updated") });
		},
		onError: fail,
	});

	const downloadMutation = useMutation({
		mutationFn: async () => {
			const auth = await sign(LP_LEDGER_DOWNLOAD_ACTION, {});
			return (await postAdmin("/api/admin/lp-incentives/ledger", auth)) as LpIncentiveLedger;
		},
		onSuccess: (ledger) => {
			const blob = new Blob([JSON.stringify(ledger, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `lp-incentives-ledger-${new Date().toISOString().slice(0, 10)}.json`;
			anchor.click();
			URL.revokeObjectURL(url);
		},
		onError: fail,
	});

	const entries = Object.values(config?.pools ?? {});
	const ledgerPools = ledgerQuery.data?.pools ?? {};
	const price = config?.veSolv3Usd ?? 0;

	const submit = () => {
		if (!poolAddress) return;
		const feeShareBps = Math.round(Number(feeSharePct) * 100);
		saveMutation.mutate({
			poolAddress,
			feeShareBps,
			multiplier: Number(multiplier),
			...(weeklyCap !== "" ? { weeklyCapSolv3: Number(weeklyCap) } : {}),
			status: "active",
			...(notes ? { notes } : {}),
		});
	};

	return (
		<Stack gap="lg">
			<CardLayout>
				<Stack gap="md">
					<Title order={4}>{i18n._("Soft-launch LP incentives")}</Title>
					<Text size="sm" c="gray">
						{i18n._(
							"Enrolled pools keep a share of each swap fee for the protocol (set on-chain below) and their LPs accrue veSOLV3 credit worth fees taken × multiplier, at {price} per veSOLV3. The keeper script samples every 10 minutes; credit is granted as locked veSOLV3 at the ve launch.",
							{ price: formatFiat(price) },
						)}
					</Text>
					<Group align="flex-end" gap="sm">
						<NumberInput
							label={i18n._("veSOLV3 display price (USD)")}
							value={veSolv3Usd}
							onChange={setVeSolv3Usd}
							placeholder={String(price)}
							min={0.0001}
							step={0.01}
							decimalScale={4}
							w={220}
						/>
						<Button
							variant="light"
							onClick={() => settingsMutation.mutate(Number(veSolv3Usd))}
							disabled={!(Number(veSolv3Usd) > 0)}
							loading={settingsMutation.isPending}
						>
							{i18n._("Update price")}
						</Button>
						<Button
							variant="outline"
							leftSection={<IconDownload size={16} />}
							onClick={() => downloadMutation.mutate()}
							loading={downloadMutation.isPending}
						>
							{i18n._("Download ledger")}
						</Button>
					</Group>
				</Stack>
			</CardLayout>

			<CardLayout>
				<Stack gap="md">
					<Title order={5}>{i18n._("Enroll a pool")}</Title>
					<Select
						label={i18n._("Pool")}
						placeholder={i18n._("Select a pool")}
						data={poolOptions}
						value={poolAddress}
						onChange={setPoolAddress}
						searchable
					/>
					<Group grow align="flex-start">
						<NumberInput
							label={i18n._("Protocol fee share (%)")}
							value={feeSharePct}
							onChange={setFeeSharePct}
							min={0}
							max={100}
							step={5}
							decimalScale={2}
						/>
						<NumberInput
							label={i18n._("Credit multiplier (×)")}
							value={multiplier}
							onChange={setMultiplier}
							min={0}
							max={10}
							step={0.1}
							decimalScale={2}
						/>
						<NumberInput
							label={i18n._("Weekly cap (SOLV3, optional)")}
							value={weeklyCap}
							onChange={setWeeklyCap}
							min={0}
							thousandSeparator
						/>
					</Group>
					<TextInput label={i18n._("Notes")} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
					<Group>
						<Button
							onClick={submit}
							disabled={!poolAddress || !(Number(multiplier) >= 0) || Number(feeSharePct) < 0 || Number(feeSharePct) > 100}
							loading={saveMutation.isPending}
						>
							{i18n._("Enroll pool")}
						</Button>
					</Group>
				</Stack>
			</CardLayout>

			<CardLayout>
				<Stack gap="md">
					<Title order={5}>{i18n._("Enrolled pools")}</Title>
					{entries.length === 0 ? (
						<Text c="gray">{i18n._("No pools enrolled.")}</Text>
					) : (
						<Table verticalSpacing="sm" highlightOnHover>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>{i18n._("Pool")}</Table.Th>
									<Table.Th>{i18n._("Status")}</Table.Th>
									<Table.Th>{i18n._("Fee share")}</Table.Th>
									<Table.Th>{i18n._("On-chain")}</Table.Th>
									<Table.Th>{i18n._("Multiplier")}</Table.Th>
									<Table.Th>{i18n._("Weekly cap")}</Table.Th>
									<Table.Th>{i18n._("7d fees taken")}</Table.Th>
									<Table.Th>{i18n._("7d credit")}</Table.Th>
									<Table.Th />
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{entries.map((entry) => {
									const chain = onChainRate(entry.poolAddress);
									const mismatch = chain !== undefined && chain !== entry.feeShareBps;
									const stats = ledgerPools[entry.poolAddress];
									const setStatus = (status: LpIncentiveStatus) =>
										saveMutation.mutate({ ...entry, status });
									return (
										<Table.Tr key={entry.poolAddress}>
											<Table.Td>
												<Stack gap={0}>
													<Text fw={600}>{poolLabel(entry.poolAddress)}</Text>
													<Text size="xs" c="gray">{formatAddress(entry.poolAddress)}</Text>
												</Stack>
											</Table.Td>
											<Table.Td>
												<Badge variant="outline" color={STATUS_COLORS[entry.status]} tt="capitalize">
													{entry.status}
												</Badge>
											</Table.Td>
											<Table.Td data-numeric="true">{entry.feeShareBps / 100}%</Table.Td>
											<Table.Td data-numeric="true">
												<Group gap={6} wrap="nowrap">
													<Text c={mismatch ? "error.8" : undefined}>
														{chain === undefined ? "—" : `${chain / 100}%`}
													</Text>
													{mismatch && (
														<Tooltip label={i18n._("On-chain rate differs from the configured share. Apply with the DEX fee-authority wallet.")}>
															<IconAlertTriangle size={16} color="var(--mantine-color-error-8)" />
														</Tooltip>
													)}
												</Group>
											</Table.Td>
											<Table.Td data-numeric="true">{entry.multiplier}×</Table.Td>
											<Table.Td data-numeric="true">
												{entry.weeklyCapSolv3 !== undefined ? entry.weeklyCapSolv3.toLocaleString() : "—"}
											</Table.Td>
											<Table.Td data-numeric="true">
												{stats ? formatFiat(Number(stats.trailing7d.feesUsd)) : "—"}
											</Table.Td>
											<Table.Td data-numeric="true">
												{stats ? `${Number(stats.trailing7d.creditSolv3).toFixed(2)} veSOLV3` : "—"}
											</Table.Td>
											<Table.Td>
												<Group gap={6} wrap="nowrap" justify="flex-end">
													{mismatch && (
														<Button
															size="xs"
															onClick={() =>
																setFeeRate.mutate({
																	poolAddress: entry.poolAddress,
																	protocolFeeRate: entry.feeShareBps,
																})
															}
															loading={setFeeRate.isPending}
														>
															{i18n._("Apply on-chain")}
														</Button>
													)}
													{entry.status === "active" ? (
														<Button size="xs" variant="light" onClick={() => setStatus("paused")}>
															{i18n._("Pause")}
														</Button>
													) : entry.status === "paused" ? (
														<Button size="xs" variant="light" onClick={() => setStatus("active")}>
															{i18n._("Resume")}
														</Button>
													) : null}
													{entry.status !== "ended" && (
														<Button size="xs" variant="subtle" color="gray" onClick={() => setStatus("ended")}>
															{i18n._("End")}
														</Button>
													)}
													<Button
														size="xs"
														variant="subtle"
														color="error.8"
														onClick={() => removeMutation.mutate(entry.poolAddress)}
													>
														{i18n._("Remove")}
													</Button>
												</Group>
											</Table.Td>
										</Table.Tr>
									);
								})}
							</Table.Tbody>
						</Table>
					)}
					{entries.some((entry) => {
						const chain = onChainRate(entry.poolAddress);
						return entry.status === "active" && chain !== undefined && chain !== entry.feeShareBps;
					}) && (
						<Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />}>
							{i18n._(
								"An active pool's on-chain fee share does not match its configuration. Until it is applied, the keeper credits whatever the chain actually took (it never assumes the configured rate) and logs a rate-mismatch warning.",
							)}
						</Alert>
					)}
					<Text size="xs" c="gray">
						{i18n._("Pausing or ending a pool stops new credit; existing credit stays in the ledger. Removing a pool also stops the reconciler from preserving its fee share — set the on-chain rate back to 0% first.")}
					</Text>
				</Stack>
			</CardLayout>
		</Stack>
	);
};
