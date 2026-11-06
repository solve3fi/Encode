import { useLingui } from "@lingui/react";
import { Button, Group, NumberInput, Select, Stack, Text } from "@mantine/core";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAllTokens } from "@/hooks/useToken";
import {
	getAllocationVoterPDA,
	getLockPDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { formatAddress } from "@/lib/format";
import { useCluster } from "@/providers/ClusterProvider";
import { useAllocationVotes } from "@/stores/admin/hooks/useAllocationVotes";
import { useGaugelessPools } from "@/stores/admin/hooks/useGaugelessPools";
import { CardLayout } from "../Layout/CardLayout";

type Row = { id: number; gauge: string | null; percent: number | string };

let nextRowId = 100;

export function AdminAllocationVotes() {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const program = useVesolveProgram();
	const { gauges } = useGaugelessPools();
	const tokens = useAllTokens();
	const mutation = useAllocationVotes();
	const registry = useQuery({
		queryKey: ["allocation-voter-registry", network],
		refetchInterval: 15_000,
		queryFn: async () => {
			const records = await vesolveAccount.allocationVoter(program).all();
			const registered: { id: number; hasVotes: boolean }[] = [];
			for (let offset = 0; offset < records.length; offset += 100) {
				const batch = records.slice(offset, offset + 100);
				const locks = await vesolveAccount
					.lock(program)
					.fetchMultiple(batch.map((item) => item.account.lock));
				locks.forEach((lock, index) => {
					if (!lock)
						throw new Error(
							"A registered allocation lock could not be loaded.",
						);
					registered.push({
						id: lock.veTokenId.toNumber(),
						hasVotes: batch[index].account.votes.length > 0,
					});
				});
			}
			return registered.sort((a, b) => a.id - b.id);
		},
	});
	const [selection, setSelection] = useState<{
		network: string;
		value: number | string;
	} | null>(null);
	const preferred =
		registry.data?.find((item) => item.hasVotes) ?? registry.data?.[0];
	const lockId =
		selection?.network === network ? selection.value : (preferred?.id ?? "");
	const veTokenId =
		typeof lockId === "number" && Number.isSafeInteger(lockId) && lockId >= 0
			? lockId
			: null;
	const selectionKey = `${network}:${veTokenId}`;
	const [draft, setDraft] = useState<{
		key: string;
		version: number;
		rows: Row[];
	} | null>(null);
	const selectLock = (value: number | string) => {
		setSelection({ network, value });
		setDraft(null);
	};

	const state = useQuery({
		queryKey: ["allocation-voter", network, veTokenId],
		enabled: veTokenId !== null,
		refetchInterval: 15_000,
		queryFn: async () => {
			if (veTokenId === null) return null;
			const [lock] = getLockPDA(veTokenId);
			const record = await vesolveAccount
				.allocationVoter(program)
				.fetchNullable(getAllocationVoterPDA(lock)[0]);
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(getProtocolPDA()[0]);
			return { record, epoch: protocol.currentEpoch.toNumber() };
		},
	});

	const record = state.data?.record;
	const savedRows: Row[] = record?.votes.length
		? record.votes.map((vote, id) => ({
				id,
				gauge: vote.gauge.toString(),
				percent: vote.weight.toNumber(),
			}))
		: [{ id: 0, gauge: null, percent: 100 }];
	const activeDraft = draft?.key === selectionKey ? draft : null;
	const rows = activeDraft?.rows ?? savedRows;
	const setRows = (updated: Row[]) => {
		setSelection({ network, value: lockId });
		setDraft({
			key: selectionKey,
			version: activeDraft?.version ?? record?.version ?? 0,
			rows: updated,
		});
	};
	const options = gauges.map((item) => ({
		value: item.publicKey.toString(),
		label: `${tokens[item.account.tokenMintA.toString()]?.symbol ?? formatAddress(item.account.tokenMintA.toString())}/${tokens[item.account.tokenMintB.toString()]?.symbol ?? formatAddress(item.account.tokenMintB.toString())} — ${formatAddress(item.account.poolAddress.toString())}`,
	}));
	for (const vote of record?.votes ?? []) {
		const gauge = vote.gauge.toString();
		if (!options.some((option) => option.value === gauge)) {
			options.push({
				value: gauge,
				label: `Saved gauge ${formatAddress(gauge)} (pool unavailable)`,
			});
		}
	}
	const gaugeLabel = (gauge: string) =>
		options.find((option) => option.value === gauge)?.label ??
		formatAddress(gauge);
	const total = rows.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
	const chosen = rows.filter((row) => row.gauge);
	const distinct =
		new Set(chosen.map((row) => row.gauge)).size === chosen.length;
	const valid =
		veTokenId !== null &&
		chosen.length === rows.length &&
		distinct &&
		total > 0 &&
		total <= 100 &&
		rows.every((row) => Number(row.percent) > 0);
	const appliedNow =
		record &&
		state.data &&
		record.appliedEpochPlusOne.toNumber() === state.data.epoch + 1 &&
		record.appliedVersion === record.version;

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Protocol allocation votes")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Set the split once and it is applied every epoch by a public step anyone can run. Change it any time before the voting cutoff; a change replaces the current epoch's vote. Unassigned power abstains. A gauge that no longer takes votes is skipped.",
					)}
				</Text>
				<Select
					label={i18n._("Registered protocol locks")}
					placeholder={
						registry.isPending
							? i18n._("Loading registered locks…")
							: i18n._("Select a registered lock")
					}
					data={(registry.data ?? []).map((item) => ({
						value: String(item.id),
						label: `Lock ${item.id} · Registered`,
					}))}
					value={
						veTokenId !== null &&
						registry.data?.some((item) => item.id === veTokenId)
							? String(veTokenId)
							: null
					}
					onChange={(value) => {
						if (value !== null) selectLock(Number(value));
					}}
					searchable
				/>
				{registry.isError || state.isError ? (
					<Text fz="sm" c="red">
						{i18n._("Unable to load protocol allocations. Please retry.")}
					</Text>
				) : null}
				<NumberInput
					label={i18n._("Lock id")}
					value={lockId}
					onChange={selectLock}
					min={0}
					allowDecimal={false}
				/>
				{veTokenId !== null && state.data && !state.isError ? (
					record ? (
						<Stack gap={4}>
							<Text fz="sm">
								{i18n._("Registered. Standing split")} (v{record.version}):{" "}
								{record.votes.length === 0
									? i18n._("none")
									: record.votes
											.map(
												(vote) =>
													`${gaugeLabel(vote.gauge.toString())} ${vote.weight.toString()}%`,
											)
											.join(", ")}
							</Text>
							<Text fz="sm" c="gray">
								{appliedNow
									? i18n._("Applied for the current epoch.")
									: i18n._("Not yet applied for the current epoch.")}
							</Text>
						</Stack>
					) : (
						<Text fz="sm">
							{i18n._("Not registered as a protocol allocation.")}
						</Text>
					)
				) : null}
				{!record && veTokenId !== null && state.data && !state.isError ? (
					<Button
						loading={mutation.isPending}
						onClick={() => mutation.mutate({ kind: "register", veTokenId })}
					>
						{i18n._("Register lock")}
					</Button>
				) : null}
				{record && veTokenId !== null ? (
					<Stack gap="sm">
						{activeDraft ? (
							<Group gap="sm">
								<Text
									fz="sm"
									c={activeDraft.version !== record.version ? "yellow" : "gray"}
								>
									{activeDraft.version !== record.version
										? i18n._(
												"The saved split changed. Review it before saving your edits.",
											)
										: i18n._("Unsaved changes")}
								</Text>
								<Button variant="subtle" onClick={() => setDraft(null)}>
									{i18n._("Reload saved split")}
								</Button>
							</Group>
						) : null}
						{rows.map((row, index) => (
							<Group key={row.id} align="flex-end" gap="sm">
								<Select
									label={i18n._("Gauge")}
									data={options}
									value={row.gauge}
									onChange={(gauge) =>
										setRows(
											rows.map((r, i) => (i === index ? { ...r, gauge } : r)),
										)
									}
									searchable
									flex={1}
									miw={200}
								/>
								<NumberInput
									label={i18n._("Share (%)")}
									value={row.percent}
									min={1}
									max={100}
									allowDecimal={false}
									onChange={(percent) =>
										setRows(
											rows.map((r, i) => (i === index ? { ...r, percent } : r)),
										)
									}
									w={110}
								/>
								<Button
									variant="subtle"
									disabled={rows.length === 1}
									onClick={() => setRows(rows.filter((_, i) => i !== index))}
								>
									{i18n._("Remove")}
								</Button>
							</Group>
						))}
						<Group gap="sm">
							<Button
								variant="light"
								disabled={rows.length >= 50}
								onClick={() =>
									setRows([
										...rows,
										{ id: nextRowId++, gauge: null, percent: 0 },
									])
								}
							>
								{i18n._("Add gauge")}
							</Button>
							<Text fz="sm" c={total > 100 ? "red" : "gray"}>
								{i18n._("Total")}: {total}% ({i18n._("rest abstains")})
							</Text>
						</Group>
						<Group gap="sm">
							<Button
								loading={mutation.isPending}
								disabled={!valid}
								onClick={() =>
									mutation.mutate(
										{
											kind: "set",
											veTokenId,
											votes: chosen.map((row) => ({
												gauge: new PublicKey(row.gauge as string),
												percent: Number(row.percent),
											})),
										},
										{
											onSuccess: () =>
												setDraft((current) =>
													current?.key === selectionKey && current.rows === rows
														? null
														: current,
												),
										},
									)
								}
							>
								{i18n._("Save standing vote")}
							</Button>
							<Button
								variant="light"
								loading={mutation.isPending}
								disabled={record.votes.length === 0 || !!appliedNow}
								onClick={() => mutation.mutate({ kind: "apply", veTokenId })}
							>
								{i18n._("Apply now")}
							</Button>
							<Button
								variant="subtle"
								color="red"
								loading={mutation.isPending}
								onClick={() =>
									mutation.mutate(
										{ kind: "set", veTokenId, votes: [] },
										{
											onSuccess: () =>
												setDraft((current) =>
													current?.key === selectionKey && current.rows === rows
														? null
														: current,
												),
										},
									)
								}
							>
								{i18n._("Clear")}
							</Button>
							<Button
								variant="subtle"
								color="red"
								loading={mutation.isPending}
								onClick={() =>
									mutation.mutate({ kind: "unregister", veTokenId })
								}
							>
								{i18n._("Unregister")}
							</Button>
						</Group>
					</Stack>
				) : null}
			</Stack>
		</CardLayout>
	);
}
