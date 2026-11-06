"use client";

import { useLingui } from "@lingui/react";
import { BN } from "@coral-xyz/anchor";
import {
	Alert,
	Button,
	Container,
	Group,
	Paper,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { IconArrowsJoin2, IconInfoCircle } from "@tabler/icons-react";
import Decimal from "decimal.js";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AppLayout } from "@/components/Layout/AppLayout";
import { LockLayout } from "@/components/Layout/LockLayout";
import { NotFound } from "@/components/Lock/NotFound";
import { TransactionStatus } from "@/components/ProtocolStatus/TransactionStatus";
import { SOLVE } from "@/configs/tokens";
import { formatTokenAmount } from "@/lib/format";
import { mapTransactionError } from "@/lib/transactionErrors";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { useLockData } from "@/stores/lock/hooks/useLockData";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { useMergeLock } from "@/stores/lock/hooks/useMergeLock";
import { getExpolerUrl } from "@/utils/externalUrl";

const toWhole = (base: BN) =>
	new Decimal(base.toString()).div(new Decimal(10).pow(SOLVE.decimals));

export default function MergeLockPage() {
	const { i18n } = useLingui();
	const { connected } = useWallet();
	const { network } = useCluster();
	const searchParams = useSearchParams();
	const isSupportedNetwork = network === ClusterNetwork.Devnet;

	const rawLockId = searchParams.get("lockId");
	const lockId =
		rawLockId !== null && Number.isFinite(Number(rawLockId))
			? Number(rawLockId)
			: undefined;

	const { data: primary, isLoading } = useLockData(lockId);
	const { data: allLocks } = useLocks();
	const mergeLock = useMergeLock();

	// Compare identifier *values*, not BN object identity — the legacy UI
	// this replaced compared BN objects directly, which never excluded the
	// current lock since useLocks and useLockData return distinct instances.
	const otherLocks = useMemo(
		() =>
			(allLocks ?? []).filter(
				(candidate) => candidate.identifier.toNumber() !== lockId,
			),
		[allLocks, lockId],
	);

	const [secondaryId, setSecondaryId] = useState<string | null>(null);
	const secondary = otherLocks.find(
		(candidate) => candidate.identifier.toString() === secondaryId,
	);

	const options = otherLocks.map((candidate) => ({
		value: candidate.identifier.toString(),
		label: `${i18n._("Lock")} #${candidate.identifier.toString()} — ${formatTokenAmount(
			toWhole(candidate.tokenAmount).toString(),
			{ decimals: SOLVE.decimals },
		)} SOLV3`,
	}));

	const combinedAmount =
		primary && secondary ? primary.tokenAmount.add(secondary.tokenAmount) : null;

	const canMerge = Boolean(connected && isSupportedNetwork && primary && secondary);
	const transactionError = mergeLock.isError
		? mapTransactionError(mergeLock.error)
		: undefined;

	const handleMerge = () => {
		if (!primary || !secondary) return;
		mergeLock.mutate({
			primaryVeTokenId: primary.identifier.toNumber(),
			secondaryVeTokenId: secondary.identifier.toNumber(),
		});
	};

	if (!isLoading && lockId !== undefined && !primary) {
		return (
			<AppLayout>
				<NotFound />
			</AppLayout>
		);
	}

	return (
		<AppLayout>
			<Container mx="auto" size="xl">
				<LockLayout
					leftTitle={i18n._("Merge Locks")}
					rightTitle={i18n._("Combined position")}
					left={
						<Stack gap="md">
							<Text fw="bold" fz="lg">
								{i18n._("Lock to merge into this one")}
							</Text>
							<Select
								placeholder={
									options.length === 0
										? i18n._("You have no other locks to merge")
										: i18n._("Select a lock")
								}
								data={options}
								value={secondaryId}
								onChange={setSecondaryId}
								searchable
								disabled={options.length === 0 || mergeLock.isPending}
							/>
							<Text fz="xs" c="dimmed">
								{i18n._("This lock")}: #{lockId ?? "—"} —{" "}
								{primary
									? formatTokenAmount(toWhole(primary.tokenAmount).toString(), {
											decimals: SOLVE.decimals,
										})
									: "—"}{" "}
								SOLV3
							</Text>
							<Alert
								icon={<IconInfoCircle size={18} />}
								color="blue"
								title={i18n._("Merging is one-way")}
							>
								{i18n._(
									"The selected lock is burned and closed; its SOLV3 and voting power move into this lock. Both locks must be owned by your wallet.",
								)}
							</Alert>
							{!isSupportedNetwork ? (
								<Alert color="orange">
									{i18n._("Switch to devnet to manage locks.")}
								</Alert>
							) : null}
						</Stack>
					}
					right={
						<Stack gap="md">
							<Paper p="md" withBorder>
								<Group justify="space-between">
									<Text c="dimmed">{i18n._("Combined locked amount")}</Text>
									<Text fw={600} data-numeric="true">
										{combinedAmount
											? formatTokenAmount(toWhole(combinedAmount).toString(), {
													decimals: SOLVE.decimals,
												})
											: "—"}{" "}
										SOLV3
									</Text>
								</Group>
								<Group justify="space-between" mt="sm">
									<Text c="dimmed">{i18n._("Combined voting power")}</Text>
									<Text fw={600} data-numeric="true">
										{combinedAmount
											? formatTokenAmount(toWhole(combinedAmount).toString(), {
													decimals: SOLVE.decimals,
												})
											: "—"}{" "}
										veSOLV3
									</Text>
								</Group>
							</Paper>
							{mergeLock.isPending ? (
								<TransactionStatus
									status="pending"
									title={i18n._("Approve and confirm the merge")}
									description={i18n._(
										"Keep this window open while the wallet request is submitted and confirmed on Solana.",
									)}
								/>
							) : null}
							{mergeLock.isSuccess ? (
								<TransactionStatus
									status="success"
									title={i18n._("Locks merged")}
									description={i18n._(
										"The combined voting power now lives on this lock.",
									)}
									signature={mergeLock.data.signature}
									explorerUrl={getExpolerUrl(
										network,
										mergeLock.data.signature,
										"tx",
									)}
								/>
							) : null}
							{transactionError ? (
								<TransactionStatus
									status="error"
									title={i18n._("Merge failed")}
									description={transactionError.message}
									details={transactionError.raw}
								/>
							) : null}
							<Button
								fullWidth
								size="lg"
								leftSection={<IconArrowsJoin2 size={18} />}
								disabled={!canMerge}
								loading={mergeLock.isPending}
								onClick={handleMerge}
							>
								{connected
									? i18n._("Merge locks")
									: i18n._("Connect wallet to continue")}
							</Button>
						</Stack>
					}
				/>
			</Container>
		</AppLayout>
	);
}
