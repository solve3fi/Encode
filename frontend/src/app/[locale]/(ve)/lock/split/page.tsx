"use client";

import { BN } from "@coral-xyz/anchor";
import { useLingui } from "@lingui/react";
import {
	Alert,
	Button,
	Container,
	Group,
	NumberInput,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { IconArrowsSplit2, IconInfoCircle } from "@tabler/icons-react";
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
import { useSplitLock } from "@/stores/lock/hooks/useSplitLock";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { getExpolerUrl } from "@/utils/externalUrl";

const toWhole = (base: BN) =>
	new Decimal(base.toString()).div(new Decimal(10).pow(SOLVE.decimals));

export default function SplitLockPage() {
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

	const { data: lock, isLoading } = useLockData(lockId);
	const { data: voteConfig } = useVoteConfig(network);
	const hasVotedThisEpoch = Boolean(
		voteConfig &&
			lock &&
			!lock.lastVoteEpoch.isZero() &&
			lock.lastVoteEpoch.eq(voteConfig.epoch),
	);
	const splitLock = useSplitLock();

	const [amount, setAmount] = useState<number | string>("");
	const numericAmount =
		typeof amount === "number" ? amount : Number(amount) || 0;

	const rawAmount = useMemo(() => {
		if (numericAmount <= 0) return null;
		try {
			return new BN(
				new Decimal(numericAmount)
					.mul(new Decimal(10).pow(SOLVE.decimals))
					.floor()
					.toFixed(0),
			);
		} catch {
			return null;
		}
	}, [numericAmount]);

	const canSplit = Boolean(
		connected &&
			isSupportedNetwork &&
			lock &&
			!hasVotedThisEpoch &&
			rawAmount?.gt(new BN(0)) &&
			rawAmount.lt(lock.tokenAmount),
	);

	const remaining = lock && rawAmount ? lock.tokenAmount.sub(rawAmount) : null;
	const transactionError = splitLock.isError
		? mapTransactionError(splitLock.error)
		: undefined;

	const handleSplit = () => {
		if (!lock || !rawAmount) return;
		splitLock.mutate({
			veTokenId: lock.identifier.toNumber(),
			amount: rawAmount,
		});
	};

	if (!isLoading && lockId !== undefined && !lock) {
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
					leftTitle={i18n._("Split Lock")}
					rightTitle={i18n._("Resulting positions")}
					left={
						<Stack gap="md">
							<Text fw="bold" fz="lg">
								{i18n._("Amount to split off")}
							</Text>
							<NumberInput
								hideControls
								min={0}
								decimalScale={SOLVE.decimals}
								value={amount}
								onChange={setAmount}
								placeholder="0.00"
								disabled={!lock || splitLock.isPending}
								styles={{ input: { textAlign: "right", fontWeight: 600 } }}
							/>
							<Text fz="xs" c="dimmed">
								{i18n._("Locked in this position")}:{" "}
								{lock
									? formatTokenAmount(toWhole(lock.tokenAmount).toString(), {
											decimals: SOLVE.decimals,
										})
									: "—"}{" "}
								SOLV3
							</Text>
							<Alert
								icon={<IconInfoCircle size={18} />}
								color="blue"
								title={i18n._("Split creates a new lock")}
							>
								{i18n._(
									"This mints a brand-new veSOLV3 NFT for the amount you split off. Both positions remain permanent locks with no decay.",
								)}
							</Alert>
							{!isSupportedNetwork ? (
								<Alert color="orange">
									{i18n._("Switch to devnet to manage locks.")}
								</Alert>
							) : null}
							{hasVotedThisEpoch ? (
								<Alert color="orange">
									{i18n._(
										"This lock voted in the current epoch, so it can't be split until next epoch.",
									)}
								</Alert>
							) : null}
						</Stack>
					}
					right={
						<Stack gap="md">
							<Paper p="md" withBorder>
								<Group justify="space-between">
									<Text c="dimmed">{i18n._("Remaining on original lock")}</Text>
									<Text fw={600} data-numeric="true">
										{remaining
											? formatTokenAmount(toWhole(remaining).toString(), {
													decimals: SOLVE.decimals,
												})
											: "—"}{" "}
										SOLV3
									</Text>
								</Group>
								<Group justify="space-between" mt="sm">
									<Text c="dimmed">{i18n._("New lock amount")}</Text>
									<Text fw={600} data-numeric="true">
										{rawAmount
											? formatTokenAmount(numericAmount, {
													decimals: SOLVE.decimals,
												})
											: "—"}{" "}
										SOLV3
									</Text>
								</Group>
							</Paper>
							{splitLock.isPending ? (
								<TransactionStatus
									status="pending"
									title={i18n._("Approve and confirm the split")}
									description={i18n._(
										"Keep this window open while the wallet request is submitted and confirmed on Solana.",
									)}
								/>
							) : null}
							{splitLock.isSuccess ? (
								<TransactionStatus
									status="success"
									title={i18n._("Lock split")}
									description={i18n._(
										"A new veSOLV3 lock now holds the split amount.",
									)}
									signature={splitLock.data.signature}
									explorerUrl={getExpolerUrl(
										network,
										splitLock.data.signature,
										"tx",
									)}
								/>
							) : null}
							{transactionError ? (
								<TransactionStatus
									status="error"
									title={i18n._("Split failed")}
									description={transactionError.message}
									details={transactionError.raw}
								/>
							) : null}
							<Button
								fullWidth
								size="lg"
								leftSection={<IconArrowsSplit2 size={18} />}
								disabled={!canSplit}
								loading={splitLock.isPending}
								onClick={handleSplit}
							>
								{connected
									? i18n._("Split lock")
									: i18n._("Connect wallet to continue")}
							</Button>
						</Stack>
					}
				/>
			</Container>
		</AppLayout>
	);
}
