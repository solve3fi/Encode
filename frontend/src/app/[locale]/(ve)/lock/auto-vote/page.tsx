"use client";

import { useLingui } from "@lingui/react";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	IconAdjustments,
	IconAlertTriangle,
	IconCoin,
	IconInfoCircle,
	IconRobot,
	IconTarget,
} from "@tabler/icons-react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppLayout } from "@/components/Layout/AppLayout";
import { LockLayout } from "@/components/Layout/LockLayout";
import { NotFound } from "@/components/Lock/NotFound";
import { TransactionStatus } from "@/components/ProtocolStatus/TransactionStatus";
import { SOLVE } from "@/configs/tokens";
import { formatTokenAmount } from "@/lib/format";
import { mapTransactionError } from "@/lib/transactionErrors";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { useAutoVoteEnrollment } from "@/stores/lock/hooks/useAutoVoteEnrollment";
import { useEnrollAutoVote } from "@/stores/lock/hooks/useEnrollAutoVote";
import { useLockData } from "@/stores/lock/hooks/useLockData";
import { useRevokeAutoVote } from "@/stores/lock/hooks/useRevokeAutoVote";
import { getExpolerUrl } from "@/utils/externalUrl";

// Devnet lock management links here for owner-signed Auto-Vote enrollment/revocation.
export default function AutoVotePage() {
	return (
		<Suspense fallback={null}>
			<AutoVoteContent />
		</Suspense>
	);
}

function AutoVoteContent() {
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
	const { data: enrollment, isLoading: isEnrollmentLoading } =
		useAutoVoteEnrollment(lock?.address);
	const enroll = useEnrollAutoVote();
	const revoke = useRevokeAutoVote();

	const isEnrolled = Boolean(enrollment);
	const canAct = Boolean(connected && isSupportedNetwork && lock);
	const activeMutation = isEnrolled ? revoke : enroll;
	const transactionError = activeMutation.isError
		? mapTransactionError(activeMutation.error)
		: undefined;

	const handleToggle = () => {
		if (!lock) return;
		const veTokenId = lock.identifier.toNumber();
		if (isEnrolled) {
			revoke.mutate({ veTokenId });
		} else {
			enroll.mutate({ veTokenId });
		}
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
			<LockLayout
				leftTitle={i18n._("Public Auto-Vote")}
				rightTitle={i18n._("Delegation summary")}
				left={
					<Stack gap="md">
						<Text fw="bold" fz="lg">
							{i18n._("Locked amount")}
						</Text>
						<Text fz="xl" fw={700}>
							{lock
								? formatTokenAmount(
										(
											Number(lock.tokenAmount.toString()) /
											10 ** SOLVE.decimals
										).toString(),
										{ decimals: SOLVE.decimals },
									)
								: "—"}{" "}
							SOLV3
						</Text>
						<Paper p="lg" withBorder>
							<Stack gap="xs">
								<Group gap="xs">
									<IconInfoCircle size={18} />
									<Text fw={700}>{i18n._("What Auto-Vote is for")}</Text>
								</Group>
								<Text fz="sm" c="dimmed">
									{i18n._(
										"Voting only pays if you do it every epoch (every week). Auto-Vote votes this lock for you, so a week you forget doesn't become a week of missed rewards. Your veSOLV3 stays in your own wallet the whole time.",
									)}
								</Text>
							</Stack>
						</Paper>
						<Paper p="lg" withBorder>
							<Stack gap="xs">
								<Group gap="xs">
									<IconTarget size={18} />
									<Text fw={700}>{i18n._("How it chooses gauges")}</Text>
								</Group>
								<Text fz="sm" c="dimmed">
									{i18n._(
										"It is optimized, not random. Each epoch a keeper adds up every active gauge's rewards (pool fees plus incentives), compares them with the votes already placed, and spreads 100% of this lock across the gauges where one more vote is estimated to earn the most. Crowded gauges earn less per vote, so it avoids piling onto them.",
									)}
								</Text>
								<Text fz="sm" c="dimmed">
									{i18n._(
										"Devnet limit: there is no price oracle yet, so only devUSDC rewards can be priced. Other reward tokens are left out of the score, and if no gauge has priced rewards the lock is split evenly across all active gauges. Mainnet will price every reward token.",
									)}
								</Text>
							</Stack>
						</Paper>
						<Paper p="lg" withBorder>
							<Stack gap="xs">
								<Group gap="xs">
									<IconAdjustments size={18} />
									<Text fw={700}>{i18n._("Want to pick the gauges yourself?")}</Text>
								</Group>
								<Text fz="sm" c="dimmed">
									{i18n._(
										"Public Auto-Vote follows this shared ranking; you can't give it your own list. To choose your own gauges, revoke Auto-Vote and vote on the Vote page. While a lock is enrolled, the keeper may replace votes you cast by hand when it runs each epoch.",
									)}
								</Text>
								<Group gap="sm">
									<Button component={Link} href="/arena" variant="light" size="xs">
										{i18n._("Open the Vote page")}
									</Button>
								</Group>
							</Stack>
						</Paper>
						<Paper p="lg" withBorder>
							<Stack gap="xs">
								<Group gap="xs">
									<IconCoin size={18} />
									<Text fw={700}>{i18n._("The fee")}</Text>
								</Group>
								<Text fz="sm" c="dimmed">
									{i18n._(
										"Voting rewards this lock earns while it is enrolled pay a 15% fee to the protocol treasury. Nothing is charged when it is not enrolled. You can revoke at any time with one transaction.",
									)}
								</Text>
							</Stack>
						</Paper>
						{!isSupportedNetwork ? (
							<Alert color="orange" icon={<IconAlertTriangle size={18} />}>
								{i18n._("Switch to devnet to manage Public Auto-Vote.")}
							</Alert>
						) : null}
					</Stack>
				}
				right={
					<Stack gap="md">
						<Paper p="md" withBorder>
							<Group justify="space-between">
								<Text c="dimmed">{i18n._("Status")}</Text>
								<Text fw={600}>
									{isEnrollmentLoading
										? "—"
										: isEnrolled
											? i18n._("Enrolled")
											: i18n._("Not enrolled")}
								</Text>
							</Group>
							<Group justify="space-between" mt="sm">
								<Text c="dimmed">{i18n._("Votes")}</Text>
								<Text fw={600}>{i18n._("Every epoch, automatically")}</Text>
							</Group>
							<Group justify="space-between" mt="sm">
								<Text c="dimmed">{i18n._("Fee on voting rewards")}</Text>
								<Text fw={600} data-numeric="true">
									15%
								</Text>
							</Group>
						</Paper>
						{activeMutation.isPending ? (
							<TransactionStatus
								status="pending"
								title={i18n._("Approve and confirm")}
								description={i18n._(
									"Keep this window open while the wallet request is submitted and confirmed on Solana.",
								)}
							/>
						) : null}
						{activeMutation.isSuccess ? (
							<TransactionStatus
								status="success"
								title={
									isEnrolled
										? i18n._("Revoked")
										: i18n._("Enrolled")
								}
								description={
									isEnrolled
										? i18n._("This lock now votes only when you vote it yourself.")
										: i18n._("The keeper will vote this lock going forward.")
								}
								signature={activeMutation.data?.signature}
								explorerUrl={
									activeMutation.data
										? getExpolerUrl(network, activeMutation.data.signature, "tx")
										: undefined
								}
							/>
						) : null}
						{transactionError ? (
							<TransactionStatus
								status="error"
								title={
									isEnrolled ? i18n._("Revoke failed") : i18n._("Enroll failed")
								}
								description={transactionError.message}
								details={transactionError.raw}
							/>
						) : null}
						<Button
							fullWidth
							size="lg"
							color={isEnrolled ? "red" : "violet"}
							leftSection={<IconRobot size={18} />}
							disabled={!canAct}
							loading={activeMutation.isPending || isEnrollmentLoading}
							onClick={handleToggle}
						>
							{connected
								? isEnrolled
									? i18n._("Revoke Auto-Vote")
									: i18n._("Enroll in Auto-Vote")
								: i18n._("Connect wallet to continue")}
						</Button>
					</Stack>
				}
			/>
		</AppLayout>
	);
}
