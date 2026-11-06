"use client";

import { BN } from "@coral-xyz/anchor";
import { useLingui } from "@lingui/react";
import {
	Alert, Anchor, Avatar, Button, CopyButton, Divider, Group,
	Modal, NumberInput, Paper, SegmentedControl, Stack, Text,
} from "@mantine/core";
import {
	AccountLayout, ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	ComputeBudgetProgram, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY,
	type Transaction, type TransactionInstruction,
} from "@solana/web3.js";
import {
	IconCheck, IconCopy, IconExternalLink, IconInfoCircle, IconLock,
	IconRefresh, IconWallet,
} from "@tabler/icons-react";
import Decimal from "decimal.js";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { VE_PROGRAM_ID } from "@/configs/addresses";
import { SOLVE } from "@/configs/tokens";
import { useAllTokenBalances } from "@/hooks/useCurrencyBalanace";
import {
	getLockPDA, getProtocolPDA, useVesolveProgram, vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { formatTokenAmount } from "@/lib/format";
import { mapTransactionError } from "@/lib/transactionErrors";
import { useCluster } from "@/providers/ClusterProvider";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { getExpolerUrl } from "@/utils/externalUrl";
import classes from "./CreateLock.module.css";


const METADATA_PROGRAM_ID = new PublicKey(
	"metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
const COMPUTE_UNIT_LIMIT = 400_000;

type PriorityPreset = "economy" | "standard" | "fast";
type RecentPriorityFee = { prioritizationFee: number };
type TransactionStage =
	| "idle" | "simulating" | "review" | "awaiting-signature"
	| "submitted" | "confirmed" | "expired" | "failed";
type PreparedLock = {
	transaction: Transaction;
	blockhash: string;
	lastValidBlockHeight: number;
	preparedAtBlockHeight: number;
	lockId: string;
	expectedSolv3Out: string | null;
	expectedVeSolv3In: string | null;
};

const u64LeBytes = (value: BN): Buffer => value.toArrayLike(Buffer, "le", 8);
const accountDataBuffer = (account: unknown): Buffer | null => {
	const data = (account as { data?: unknown } | null)?.data;
	if (Array.isArray(data) && typeof data[0] === "string") {
		return Buffer.from(data[0], "base64");
	}
	if (typeof data === "string") return Buffer.from(data, "base64");
	return null;
};
const toTokenAmount = (raw: bigint): string =>
	new Decimal(raw.toString())
		.div(new Decimal(10).pow(SOLVE.decimals))
		.toString();

export const CreateLock: React.FC = () => {
	const { i18n } = useLingui();
	const { connected, publicKey, sendTransaction } = useWallet();
	const { network } = useCluster();
	const program = useVesolveProgram();
	const connection = program.provider.connection;
	const initialAmount = useSearchParams().get("amount");
	const [amount, setAmount] = useState<number | string>(initialAmount && Number(initialAmount) > 0 ? Number(initialAmount) : "");
	// The command bar can prefill the amount while this page is already open.
	useEffect(() => {
		if (initialAmount && Number(initialAmount) > 0) setAmount(Number(initialAmount));
	}, [initialAmount]);
	const [reviewAmount, setReviewAmount] = useState(0);
	const [reviewOpen, setReviewOpen] = useState(false);
	const [stage, setStage] = useState<TransactionStage>("idle");
	const [prepared, setPrepared] = useState<PreparedLock | null>(null);
	const [priorityPreset, setPriorityPreset] = useState<PriorityPreset>("standard");
	const [recentPriorityFee, setRecentPriorityFee] = useState(0);
	const [createdLockId, setCreatedLockId] = useState<string | null>(null);
	const [signature, setSignature] = useState<string | null>(null);
	const [simulationError, setSimulationError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [rawError, setRawError] = useState<string | null>(null);

	const numericAmount = typeof amount === "number" ? amount : Number(amount) || 0;
	// veSOLV3 is supported wherever a vote-escrow program is deployed.
	const isSupportedNetwork = !VE_PROGRAM_ID[network].equals(PublicKey.default);
	const [acknowledged, setAcknowledged] = useState(false);
	const { setOpenModal } = useModalActions();
	const { data: balances } = useAllTokenBalances();
	const solv3Balance = balances?.[SOLVE.address]
		? new Decimal(balances[SOLVE.address].toString()).div(new Decimal(10).pow(SOLVE.decimals))
		: new Decimal(0);
	const canCreate = connected && isSupportedNetwork && numericAmount > 0 && acknowledged;

	useEffect(() => {
		let active = true;
		(connection as unknown as {
			getRecentPrioritizationFees: () => Promise<RecentPriorityFee[]>;
		}).getRecentPrioritizationFees().then((fees: RecentPriorityFee[]) => {
			if (!active) return;
			const nonZero = fees.map(({ prioritizationFee }) => prioritizationFee)
				.filter((fee) => fee > 0).sort((a, b) => a - b);
			setRecentPriorityFee(nonZero.length ? nonZero[Math.floor(nonZero.length / 2)] : 0);
		}).catch(() => setRecentPriorityFee(0));
		return () => { active = false; };
	}, [connection]);

	const priorityFees = useMemo(() => ({
		economy: 0,
		standard: Math.max(1_000, recentPriorityFee),
		fast: Math.max(5_000, recentPriorityFee * 2),
	}), [recentPriorityFee]);
	const networkCondition = recentPriorityFee === 0
		? "Calm" : recentPriorityFee < 5_000 ? "Active" : "Busy";

	const prepareLock = async (lockAmount: number, preset: PriorityPreset = priorityPreset) => {
		if (!publicKey || lockAmount <= 0) return;
		setStage("simulating");
		setPrepared(null);
		setSimulationError(null);
		setError(null);
		setRawError(null);
		setSignature(null);
		try {
			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount.protocol(program).fetch(protocolAddress);
			const lockId = protocol.nextNftTokenId;
			const [lockAddress] = getLockPDA(BigInt(lockId.toString()));
			const [veMint] = PublicKey.findProgramAddressSync(
				[Buffer.from("ve_token"), u64LeBytes(lockId)], program.programId,
			);
			const userTokenAccount = getAssociatedTokenAddressSync(new PublicKey(SOLVE.address), publicKey);
			const protocolTokenAccount = getAssociatedTokenAddressSync(
				new PublicKey(SOLVE.address), protocolAddress, true,
			);
			const veTokenAccount = getAssociatedTokenAddressSync(veMint, publicKey);
			const [metadata] = PublicKey.findProgramAddressSync([
				Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), veMint.toBuffer(),
			], METADATA_PROGRAM_ID);
			const rawAmount = new BN(new Decimal(lockAmount)
				.mul(new Decimal(10).pow(SOLVE.decimals)).floor().toFixed(0));
			const preInstructions: TransactionInstruction[] = [
				ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
			];
			const microLamports = priorityFees[preset];
			if (microLamports > 0) {
				preInstructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
			}
			if (!(await connection.getAccountInfo(protocolTokenAccount))) {
				preInstructions.push(createAssociatedTokenAccountInstruction(
					publicKey, protocolTokenAccount, protocolAddress, new PublicKey(SOLVE.address),
				));
			}
			const transaction = await program.methods.createLock(rawAmount, new BN(0)).accounts({
				user: publicKey,
				protocol: protocolAddress,
				lock: lockAddress,
				userTokenAccount,
				tokenMint: new PublicKey(SOLVE.address),
				protocolTokenAccount,
				veMint,
				veTokenAccount,
				metadata,
				systemProgram: SystemProgram.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
				associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				metadataProgram: METADATA_PROGRAM_ID,
				rent: SYSVAR_RENT_PUBKEY,
			}).preInstructions(preInstructions).transaction();
			const [{ blockhash, lastValidBlockHeight }, preparedAtBlockHeight] = await Promise.all([
				connection.getLatestBlockhash("confirmed"), connection.getBlockHeight("confirmed"),
			]);
			transaction.feePayer = publicKey;
			transaction.recentBlockhash = blockhash;
			const beforeUserAccount = await connection.getAccountInfo(userTokenAccount);
			const beforeUserAmount = beforeUserAccount
				? BigInt(AccountLayout.decode(beforeUserAccount.data).amount.toString()) : BigInt(0);
			const simulation = await connection.simulateTransaction(
				transaction, undefined, [userTokenAccount, lockAddress],
			);
			const rawSimulation = [JSON.stringify(simulation.value.err), ...(simulation.value.logs ?? [])].join("\n");
			let expectedSolv3Out: string | null = null;
			let expectedVeSolv3In: string | null = null;
			if (simulation.value.err) {
				const mapped = mapTransactionError(rawSimulation);
				setSimulationError(`Simulation failed: ${mapped.message} Signing may fail for the same reason.`);
				setRawError(rawSimulation);
			} else {
				const postUserData = accountDataBuffer(simulation.value.accounts?.[0]);
				const postLockData = accountDataBuffer(simulation.value.accounts?.[1]);
				if (postUserData && postLockData && postLockData.length >= 104) {
					const postUserAmount = BigInt(AccountLayout.decode(postUserData).amount.toString());
					const solv3Delta = beforeUserAmount > postUserAmount ? beforeUserAmount - postUserAmount : BigInt(0);
					expectedSolv3Out = toTokenAmount(solv3Delta);
					// Avoids Buffer.prototype.readBigUInt64LE for the same reason
					// u64LeBytes in useVesolveProgram.ts avoids writeBigUInt64LE.
					let veSolv3Amount = BigInt(0);
					const eight = BigInt(8);
					for (let i = 7; i >= 0; i--) {
						veSolv3Amount = (veSolv3Amount << eight) | BigInt(postLockData[96 + i]);
					}
					expectedVeSolv3In = toTokenAmount(veSolv3Amount);
				} else {
					setSimulationError("Simulation succeeded, but the RPC did not return the requested account balance changes. Review the amount carefully before signing.");
				}
			}
			setPrepared({
				transaction, blockhash, lastValidBlockHeight, preparedAtBlockHeight,
				lockId: lockId.toString(), expectedSolv3Out, expectedVeSolv3In,
			});
			setStage("review");
		} catch (reason) {
			const mapped = mapTransactionError(reason);
			setError(mapped.message);
			setRawError(mapped.raw);
			setStage(mapped.kind === "expired" ? "expired" : "failed");
		}
	};

	const openReview = () => {
		if (!canCreate) return;
		setReviewAmount(numericAmount);
		setReviewOpen(true);
		void prepareLock(numericAmount);
	};
	const changePriority = (value: string) => {
		const preset = value as PriorityPreset;
		setPriorityPreset(preset);
		void prepareLock(reviewAmount, preset);
	};
	const submitLock = async () => {
		if (!prepared || !publicKey) return;
		setError(null);
		setRawError(null);
		try {
			// prepared.blockhash is from whenever the review modal opened --
			// for an irreversible action like this, the user often spends real
			// time reading the warning and approving in their wallet, which can
			// burn most or all of the ~150-block confirmation window before the
			// transaction is even sent. Refresh right before sending so the
			// window starts now instead of whenever the modal first opened.
			const { blockhash, lastValidBlockHeight } =
				await connection.getLatestBlockhash("confirmed");
			prepared.transaction.recentBlockhash = blockhash;
			setStage("awaiting-signature");
			const nextSignature = await sendTransaction(prepared.transaction, connection, {
				maxRetries: 3, skipPreflight: false,
			});
			setSignature(nextSignature);
			setStage("submitted");
			const confirmation = await connection.confirmTransaction({
				signature: nextSignature,
				blockhash,
				lastValidBlockHeight,
			}, "confirmed");
			if (confirmation.value.err) throw new Error(JSON.stringify(confirmation.value.err));
			setCreatedLockId(prepared.lockId);
			setAmount("");
			setStage("confirmed");
		} catch (reason) {
			const mapped = mapTransactionError(reason);
			setError(mapped.message);
			setRawError(mapped.raw);
			setStage(mapped.kind === "expired" ? "expired" : "failed");
		}
	};

	const explorerUrl = signature ? getExpolerUrl(network, signature, "tx") : null;
	const selectedMicroLamports = priorityFees[priorityPreset];
	const maximumPrioritySol = selectedMicroLamports * COMPUTE_UNIT_LIMIT / 1_000_000 / 1_000_000_000;
	const statusMessage = connected
		? isSupportedNetwork
			? i18n._("Permanent veSOLV3 locking is live.")
			: i18n._("veSOLV3 is not available on the selected network.")
		: i18n._("Connect your wallet to create a veNFT lock.");

	const setFraction = (fraction: number) =>
		setAmount(
			solv3Balance
				.mul(fraction)
				.toDecimalPlaces(SOLVE.decimals, Decimal.ROUND_DOWN)
				.toNumber(),
		);

	return <>
		<section aria-label={i18n._("Create lock")} className={classes.card} id="create-lock">
			<h2 className={classes.eyebrow}>{i18n._("Create a permanent lock")}</h2>
			<div className={classes.field}>
				<div className={classes.fieldTop}>
					<span className={classes.label}>{i18n._("You lock")}</span>
					<span className={classes.balance}>
						{i18n._("Balance")} {formatTokenAmount(solv3Balance.toNumber(), { decimals: 2 })}
						<button type="button" className={classes.chip} onClick={() => setFraction(0.5)} disabled={solv3Balance.isZero()}>{i18n._("Half")}</button>
						<button type="button" className={classes.chip} onClick={() => setFraction(1)} disabled={solv3Balance.isZero()}>{i18n._("Max")}</button>
					</span>
				</div>
				<div className={classes.fieldMain}>
					<NumberInput
						aria-label={i18n._("Amount of SOLV3 to lock")}
						hideControls min={0} decimalScale={SOLVE.decimals}
						variant="unstyled"
						classNames={{ root: classes.amount, input: classes.amount }}
						value={amount} onChange={setAmount} placeholder="0"
					/>
					<span className={classes.token}>
						<Avatar size={28} src={SOLVE.logoURI} alt={SOLVE.name} />
						{SOLVE.symbol}
					</span>
				</div>
			</div>

			<div className={classes.field}>
				<div className={classes.fieldTop}>
					<span className={classes.label}>{i18n._("You receive")}</span>
				</div>
				<div className={classes.fieldMain}>
					<span className={classes.amount} data-numeric="true">
						{numericAmount > 0 ? formatTokenAmount(numericAmount, { decimals: SOLVE.decimals }) : "0"}
					</span>
					<span className={classes.token}>veSOLV3</span>
				</div>
				<span className={classes.sub}>{i18n._("1 SOLV3 locked = 1 veSOLV3. Voting power does not decay.")}</span>
			</div>

			<dl className={classes.summary}>
				<dt>{i18n._("Lock type")}</dt>
				<dd>{i18n._("Permanent")}</dd>
				<dt>{i18n._("Voting power")}</dt>
				<dd data-numeric="true">{formatTokenAmount(numericAmount, { decimals: SOLVE.decimals })} veSOLV3</dd>
				<dt>{i18n._("Network status")}</dt>
				<dd className={classes.status}>{statusMessage}</dd>
			</dl>

			<label className={classes.ack}>
				<input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.currentTarget.checked)} />
				<span>{i18n._("I understand this lock is permanent. The only early exit is a paid exit.")}</span>
			</label>

			{createdLockId ? <Alert color="green" title={i18n._("Lock created")}>
				{i18n._("Your permanent veSOLV3 lock is ready.")} ID #{createdLockId}
			</Alert> : null}

			{connected ? (
				<button type="button" className={classes.primary} disabled={!canCreate} onClick={openReview}>
					{i18n._("Review permanent lock")}
				</button>
			) : (
				<button type="button" className={classes.primary} onClick={() => setOpenModal(ModalType.WALLET)}>
					{i18n._("Connect wallet")}
				</button>
			)}
		</section>

		<Modal opened={reviewOpen} onClose={() => setReviewOpen(false)} title={i18n._("Review permanent lock")} size="lg" centered radius={24}
			overlayProps={{ color: "#05050c", backgroundOpacity: 0.76, blur: 6 }}
			classNames={{ content: classes.reviewContent, header: classes.reviewHeader, title: classes.reviewTitle, close: classes.reviewClose, body: classes.reviewBody }}>
			<Stack gap="lg">
				<Alert color="blue" icon={<IconLock size={18} />} title={i18n._("Permanent means permanent")} classNames={{ root: classes.reviewNote, title: classes.reviewNoteTitle }}>
					{i18n._("This action cannot be undone. The SOLV3 stays locked and becomes permanent veSOLV3 voting power.")}
				</Alert>
				<Stack gap="xs">
					<Group justify="space-between">
						<Text fw={600}>{i18n._("Priority fee")}</Text>
						<Text fz="sm" c="dimmed">{i18n._("Network")}: {networkCondition}</Text>
					</Group>
					<SegmentedControl fullWidth value={priorityPreset} onChange={changePriority} classNames={{ root: classes.reviewSegments }}
						disabled={stage === "submitted" || stage === "awaiting-signature"}
						data={[
							{ value: "economy", label: i18n._("Economy") },
							{ value: "standard", label: i18n._("Standard") },
							{ value: "fast", label: i18n._("Fast") },
						]}
					/>
					<Text fz="xs" c="dimmed">{selectedMicroLamports.toLocaleString()} micro-lamports/CU · up to {formatTokenAmount(maximumPrioritySol, { decimals: 6 })} SOL</Text>
				</Stack>
				<Divider />
				<Stack gap="sm">
					<Group justify="space-between">
						<Text fw={600}>{i18n._("Simulated balance changes")}</Text>
						<Text fz="xs" c="dimmed">{i18n._("Solana simulation")}</Text>
					</Group>
					<Paper withBorder p="md" className={classes.reviewBox}><Stack gap="sm">
						<Group justify="space-between">
							<Text c="dimmed">{i18n._("Wallet sends")}</Text>
							<Text fw={700} data-numeric="true">{stage === "simulating" ? "Simulating…" : prepared?.expectedSolv3Out ? `${formatTokenAmount(prepared.expectedSolv3Out, { decimals: SOLVE.decimals })} SOLV3` : "—"}</Text>
						</Group>
						<Group justify="space-between">
							<Text c="dimmed">{i18n._("Lock receives")}</Text>
							<Text fw={700} data-numeric="true">{stage === "simulating" ? "Simulating…" : prepared?.expectedVeSolv3In ? `${formatTokenAmount(prepared.expectedVeSolv3In, { decimals: SOLVE.decimals })} veSOLV3` : "—"}</Text>
						</Group>
					</Stack></Paper>
				</Stack>
				{simulationError ? <Alert color="orange" title={i18n._("Simulation warning")}>{simulationError}</Alert> : null}
				{error ? <Alert color="red">{error}</Alert> : null}
				{prepared && stage !== "confirmed" ? <Text fz="sm" c="dimmed">
					{i18n._("Confirmation window")}: approximately {Math.max(0, prepared.lastValidBlockHeight - prepared.preparedAtBlockHeight).toLocaleString()} blocks
				</Text> : null}
				{signature && explorerUrl ? <Alert
					color={stage === "confirmed" ? "green" : "blue"}
					icon={stage === "confirmed" ? <IconCheck size={18} /> : <IconWallet size={18} />}
					title={stage === "confirmed" ? i18n._("Confirmed") : i18n._("Submitted — confirming")}
				>
					<Stack gap="xs">
						<Text ff="monospace" fz="sm">{`${signature.slice(0, 8)}…${signature.slice(-8)}`}</Text>
						<Group gap="sm">
							<CopyButton value={signature}>{({ copied, copy }) => <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={copy}>
								{copied ? i18n._("Copied") : i18n._("Copy signature")}
							</Button>}</CopyButton>
							<Anchor href={explorerUrl} target="_blank" rel="noreferrer" fz="sm">{i18n._("View in Explorer")} <IconExternalLink size={13} /></Anchor>
						</Group>
					</Stack>
				</Alert> : null}
				{rawError ? <details>
					<summary>{i18n._("Technical details")}</summary>
					<Text component="pre" fz="xs" mt="xs" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{rawError}</Text>
				</details> : null}
				{stage === "confirmed" ? <Stack gap="sm">
					<Alert color="green" title={i18n._("Permanent lock created")}>{i18n._("Your veSOLV3 voting power is ready. Next, assign it to active gauges before the vote cutoff.")}</Alert>
					<Button component={Link} href="/arena" fullWidth size="lg">{i18n._("Vote with this lock")}</Button>
				</Stack> : stage === "expired" ? <Button fullWidth size="lg" leftSection={<IconRefresh size={18} />} onClick={() => void prepareLock(reviewAmount)}>
					{i18n._("Rebuild transaction")}
				</Button> : <Group grow>
					<Button variant="default" size="lg" radius={12} className={classes.reviewCancel} onClick={() => setReviewOpen(false)} disabled={stage === "submitted"}>{i18n._("Cancel")}</Button>
					<Button size="lg" radius={12} className={classes.reviewSign} leftSection={<IconWallet size={18} />} disabled={!prepared || stage === "simulating" || stage === "submitted"}
						loading={stage === "awaiting-signature" || stage === "submitted"} onClick={submitLock}>
						{simulationError ? i18n._("Sign anyway") : i18n._("Sign permanent lock")}
					</Button>
				</Group>}
			</Stack>
		</Modal>
	</>;
};
