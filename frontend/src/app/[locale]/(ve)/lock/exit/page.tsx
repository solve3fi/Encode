"use client";

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
import { IconAlertTriangle, IconInfoCircle, IconLockOpen } from "@tabler/icons-react";
import Decimal from "decimal.js";
import { useSearchParams } from "next/navigation";
import BN from "bn.js";
import { useState } from "react";
import { AppLayout } from "@/components/Layout/AppLayout";
import { LockLayout } from "@/components/Layout/LockLayout";
import { NotFound } from "@/components/Lock/NotFound";
import { TransactionStatus } from "@/components/ProtocolStatus/TransactionStatus";
import { EXIT_DISABLED_UNTIL_EPOCH } from "@/configs/lockExit";
import { SOLVE } from "@/configs/tokens";
import { formatTokenAmount } from "@/lib/format";
import { mapTransactionError } from "@/lib/transactionErrors";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { calculateExitFeeLamports, useExitConfig } from "@/stores/lock/hooks/useExitConfig";
import { effectiveExitFeeBps, useExitFeeConfig } from "@/stores/lock/hooks/useExitFeeConfig";
import { useExitLock } from "@/stores/lock/hooks/useExitLock";
import { useLockData } from "@/stores/lock/hooks/useLockData";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { getExpolerUrl } from "@/utils/externalUrl";

const toWholeString = (base: bigint, decimals: number) =>
	new Decimal(base.toString()).div(new Decimal(10).pow(decimals)).toString();

export default function ExitLockPage() {
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
	const { data: exitConfig, isLoading: isExitConfigLoading } = useExitConfig();
	const { data: voteConfig } = useVoteConfig(network);
	const { data: exitFeeConfig } = useExitFeeConfig();
	const exitLock = useExitLock();
	// "" = exit the whole lock; a smaller whole-SOLV3 amount exits just that part.
	const [amountInput, setAmountInput] = useState<number | string>("");

	const hasRate = Boolean(exitConfig && exitConfig.lamportsPerSolv3 > BigInt(0));
	// Mirrors EXIT_DISABLED_UNTIL_EPOCH in vesolve's constants/ve.rs: exit_lock
	// fails with ExitDisabled before this epoch regardless of price.
	const exitOpen = Boolean(voteConfig?.epoch.gten(EXIT_DISABLED_UNTIL_EPOCH));
	const canExitVotes = Boolean(
		lock && voteConfig && lock.lastVoteEpoch.lt(voteConfig.epoch),
	);

	const lockedAmount = lock ? BigInt(lock.tokenAmount.toString()) : null;
	const feeBps =
		exitFeeConfig && voteConfig
			? effectiveExitFeeBps(exitFeeConfig, voteConfig.epoch.toNumber())
			: (exitFeeConfig?.feeBps ?? null);
	const feePercent = feeBps !== null ? feeBps / 100 : null;

	// Base units the user wants out. Whole lock unless a smaller amount is typed.
	let exitedAmount: bigint | null = lockedAmount;
	let amountValid = true;
	if (lockedAmount !== null && amountInput !== "" && Number(amountInput) > 0) {
		const typed = BigInt(
			new Decimal(amountInput)
				.mul(new Decimal(10).pow(SOLVE.decimals))
				.floor()
				.toFixed(0),
		);
		amountValid = typed > BigInt(0) && typed <= lockedAmount;
		exitedAmount = amountValid ? typed : null;
	} else if (amountInput !== "") {
		amountValid = false;
		exitedAmount = null;
	}
	const isPartial =
		exitedAmount !== null && lockedAmount !== null && exitedAmount < lockedAmount;

	const feeLamports =
		exitedAmount !== null && exitConfig && feeBps !== null
			? calculateExitFeeLamports(exitedAmount, exitConfig.lamportsPerSolv3, feeBps)
			: null;
	const feeSol = feeLamports !== null ? toWholeString(feeLamports, 9) : null;

	const canExit = Boolean(
		connected &&
			isSupportedNetwork &&
			lock &&
			hasRate &&
			canExitVotes &&
			exitOpen &&
			amountValid &&
			feeBps !== null,
	);
	const transactionError = exitLock.isError
		? mapTransactionError(exitLock.error)
		: undefined;

	const handleExit = () => {
		if (!lock) return;
		exitLock.mutate({
			veTokenId: lock.identifier.toNumber(),
			partialAmount:
				isPartial && exitedAmount !== null
					? new BN(exitedAmount.toString())
					: undefined,
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
					leftTitle={i18n._("Exit Lock")}
					rightTitle={i18n._("Exit summary")}
					left={
						<Stack gap="md">
							<Text fw="bold" fz="lg">
								{i18n._("Locked amount")}
							</Text>
							<Text fz="xl" fw={700}>
								{lock
									? formatTokenAmount(
											toWholeString(
												BigInt(lock.tokenAmount.toString()),
												SOLVE.decimals,
											),
											{ decimals: SOLVE.decimals },
										)
									: "—"}{" "}
								SOLV3
							</Text>
							<NumberInput
								label={i18n._("Amount to exit (SOLV3)")}
								description={i18n._("Leave empty to exit the whole lock.")}
								placeholder={
									lockedAmount !== null
										? toWholeString(lockedAmount, SOLVE.decimals)
										: ""
								}
								min={0}
								decimalScale={SOLVE.decimals}
								value={amountInput}
								onChange={setAmountInput}
								error={
									amountValid
										? undefined
										: i18n._("Enter an amount up to your locked balance.")
								}
							/>
							<Alert
								icon={<IconInfoCircle size={18} />}
								color="orange"
								title={i18n._("Oracle-priced exit")}
							>
								{i18n._(
									`Exiting early charges ${feePercent ?? "…"}% of the exited amount's published market value in SOL and returns that SOLV3. Anything you leave stays locked. The rate is admin-published, not a live oracle feed.`,
								)}
							</Alert>
							{voteConfig && !exitOpen ? (
								<Alert
									icon={<IconAlertTriangle size={18} />}
									color="red"
									title={i18n._("Exit is not open yet")}
								>
									{i18n._(
										`Early exit is disabled until epoch ${EXIT_DISABLED_UNTIL_EPOCH}. Locks can still be held, voted with and extended.`,
									)}
								</Alert>
							) : null}
							{!isExitConfigLoading && !hasRate ? (
								<Alert
									icon={<IconAlertTriangle size={18} />}
									color="red"
									title={i18n._("Exit price not set")}
								>
									{i18n._(
										"An admin has not published a SOLV3/SOL rate yet, so locks cannot be exited.",
									)}
								</Alert>
							) : null}
							{lock && voteConfig && !canExitVotes ? (
								<Alert
									icon={<IconAlertTriangle size={18} />}
									color="red"
									title={
										lock.lastVoteEpoch.isZero()
											? i18n._("Exit opens after the first epoch")
											: i18n._("Lock has active votes")
									}
								>
									{lock.lastVoteEpoch.isZero()
										? i18n._(
												"Locks cannot be exited during the first epoch, even before they have voted. This lock can be exited once the next epoch starts.",
											)
										: i18n._(
												"This lock voted in the current epoch and can't be exited until the next epoch starts.",
											)}
								</Alert>
							) : null}
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
									<Text c="dimmed">{i18n._("Published rate")}</Text>
									<Text fw={600} data-numeric="true">
										{exitConfig
											? `${formatTokenAmount(toWholeString(exitConfig.lamportsPerSolv3, 9), { decimals: 9 })} SOL / SOLV3`
											: "—"}
									</Text>
								</Group>
								<Group justify="space-between" mt="sm">
									<Text c="dimmed">{i18n._("Exit fee")} ({feePercent ?? "—"}%)</Text>
									<Text fw={600} data-numeric="true">
										{feeSol
											? `${formatTokenAmount(feeSol, { decimals: 9 })} SOL`
											: "—"}
									</Text>
								</Group>
								<Group justify="space-between" mt="sm">
									<Text c="dimmed">{i18n._("SOLV3 returned")}</Text>
									<Text fw={600} data-numeric="true">
										{exitedAmount !== null
											? formatTokenAmount(
													toWholeString(exitedAmount, SOLVE.decimals),
													{ decimals: SOLVE.decimals },
												)
											: "—"}{" "}
										SOLV3
									</Text>
								</Group>
								{isPartial && lockedAmount !== null && exitedAmount !== null ? (
									<Group justify="space-between" mt="sm">
										<Text c="dimmed">{i18n._("Stays locked")}</Text>
										<Text fw={600} data-numeric="true">
											{formatTokenAmount(
												toWholeString(lockedAmount - exitedAmount, SOLVE.decimals),
												{ decimals: SOLVE.decimals },
											)}{" "}
											SOLV3
										</Text>
									</Group>
								) : null}
							</Paper>
							{exitLock.isPending ? (
								<TransactionStatus
									status="pending"
									title={i18n._("Approve and confirm the exit")}
									description={i18n._(
										"Keep this window open while the wallet request is submitted and confirmed on Solana.",
									)}
								/>
							) : null}
							{exitLock.isSuccess ? (
								<TransactionStatus
									status="success"
									title={i18n._("Lock exited")}
									description={
										isPartial
											? i18n._(
													"The SOLV3 you exited was returned to your wallet; the rest stays locked.",
												)
											: i18n._(
													"The full SOLV3 principal was returned to your wallet.",
												)
									}
									signature={exitLock.data.signature}
									explorerUrl={getExpolerUrl(
										network,
										exitLock.data.signature,
										"tx",
									)}
								/>
							) : null}
							{transactionError ? (
								<TransactionStatus
									status="error"
									title={i18n._("Exit failed")}
									description={transactionError.message}
									details={transactionError.raw}
								/>
							) : null}
							<Button
								fullWidth
								size="lg"
								color="orange"
								leftSection={<IconLockOpen size={18} />}
								disabled={!canExit}
								loading={exitLock.isPending}
								onClick={handleExit}
							>
								{connected
									? isPartial
										? i18n._("Exit part of lock")
										: i18n._("Exit lock")
									: i18n._("Connect wallet to continue")}
							</Button>
						</Stack>
					}
				/>
			</Container>
		</AppLayout>
	);
}
