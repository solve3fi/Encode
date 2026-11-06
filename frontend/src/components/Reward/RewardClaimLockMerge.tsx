"use client";

import { BN } from "@coral-xyz/anchor";
import { Button, Modal, Stack, Text } from "@mantine/core";
import {
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SOLVE } from "@/configs/tokens";
import { useClaimAllRewards } from "@/hooks/useClaimAllRewards";
import { useTotalClaimableRewards } from "@/hooks/useTotalClaimableRewards";
import {
	getAutoVoteDelegatePDA,
	getAutoVoteEnrollmentPDA,
	getLockPDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { useVoteRewards } from "@/hooks/useVoteRewards";
import {
	claimedSolv3ToLock,
	formatSolv3,
	highestVeNft,
} from "@/lib/rewardClaimLockMerge";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { useLocks } from "@/stores/lock/hooks/useLocks";

export const RewardClaimLockMerge: React.FC = () => {
	const { publicKey } = useWallet();
	const { network } = useCluster();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();
	const claimAll = useClaimAllRewards();
	const { data: locks, isLoading: locksLoading } = useLocks();
	const { data: voteRows, isLoading: voteLoading } = useVoteRewards();
	const { amountsByMint: lpAmounts, isLoading: lpLoading } =
		useTotalClaimableRewards();
	const [opened, setOpened] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const target = highestVeNft(locks ?? []);

	const quotedSolv3 = useMemo(() => {
		let amount = lpAmounts[SOLVE.address] ?? new BN(0);
		for (const row of voteRows ?? []) {
			if (row.rewardMint.toBase58() === SOLVE.address)
				amount = amount.add(row.rewardAmount);
			const net = (value: BN) =>
				value.muln(10_000 - row.autoVoteFeeBps).divn(10_000);
			if (row.tokenMintA.toBase58() === SOLVE.address)
				amount = amount.add(net(row.poolRewardAmountA));
			if (row.tokenMintB.toBase58() === SOLVE.address)
				amount = amount.add(net(row.poolRewardAmountB));
			for (const bribe of row.bribes) {
				if (bribe.mint.toBase58() === SOLVE.address)
					amount = amount.add(net(bribe.amount));
			}
		}
		return BigInt(amount.toString());
	}, [lpAmounts, voteRows]);

	if (network !== ClusterNetwork.Devnet) return null;

	const readSolv3Balance = async () => {
		if (!publicKey) return BigInt(0);
		const mint = (
			await vesolveAccount.protocol(program).fetch(getProtocolPDA()[0])
		).tokenMint;
		if (mint.toBase58() !== SOLVE.address)
			throw new Error("Devnet SOLV3 mint does not match the active protocol.");
		const ata = getAssociatedTokenAddressSync(mint, publicKey);
		const connection = program.provider.connection;
		if (!(await connection.getAccountInfo(ata, "confirmed"))) return BigInt(0);
		return BigInt(
			(await connection.getTokenAccountBalance(ata, "confirmed")).value.amount,
		);
	};

	const send = async (transaction: Transaction) => {
		const signature = await program.provider.sendAndConfirm?.(transaction);
		if (!signature)
			throw new Error(
				"Wallet provider did not return a transaction signature.",
			);
		await program.provider.connection.confirmTransaction(
			signature,
			"confirmed",
		);
	};

	const run = async () => {
		if (!publicKey || !target || busy) return;
		setBusy(true);
		setMessage(null);
		let claimed = 0;
		let locked = BigInt(0);
		let merged = 0;
		let skipped = 0;
		try {
			const before = await readSolv3Balance();
			const result = await claimAll.mutateAsync();
			claimed = result.claimedCount;
			if (result.failedCount > 0) {
				throw new Error(
					`${result.failedCount} reward claims failed. Locking and merging stopped; review your wallet before retrying.`,
				);
			}
			const after = await readSolv3Balance();
			const amountToLock = claimedSolv3ToLock(before, after, quotedSolv3);
			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(protocolAddress);
			const targetId = target.identifier.toString();
			const [primaryLock] = getLockPDA(BigInt(targetId));

			if (amountToLock > BigInt(0)) {
				const mint = protocol.tokenMint;
				const ix = await program.methods
					.increaseLock(new BN(targetId), new BN(amountToLock.toString()))
					.accounts({
						user: publicKey,
						protocol: protocolAddress,
						lock: primaryLock,
						userTokenAccount: getAssociatedTokenAddressSync(mint, publicKey),
						tokenMint: mint,
						protocolTokenAccount: getAssociatedTokenAddressSync(
							mint,
							protocolAddress,
							true,
						),
						tokenProgram: TOKEN_PROGRAM_ID,
					})
					.instruction();
				await send(new Transaction().add(ix));
				locked = amountToLock;
			}

			const sources = (locks ?? []).filter(
				(lock) => !lock.identifier.eq(target.identifier),
			);
			for (const source of sources) {
				const [secondaryLock] = getLockPDA(
					BigInt(source.identifier.toString()),
				);
				const [primary, secondary] = await Promise.all([
					vesolveAccount.lock(program).fetchNullable(primaryLock),
					vesolveAccount.lock(program).fetchNullable(secondaryLock),
				]);
				if (
					!primary ||
					!secondary ||
					!primary.owner.equals(publicKey) ||
					!secondary.owner.equals(publicKey)
				) {
					skipped++;
					continue;
				}
				// A merge burns the source veNFT. The program rejects an active vote on either lock.
				if (
					protocol.currentEpoch.isZero() ||
					primary.lastVoteEpoch.gte(protocol.currentEpoch) ||
					secondary.lastVoteEpoch.gte(protocol.currentEpoch)
				) {
					skipped++;
					continue;
				}

				const [enrollment] = getAutoVoteEnrollmentPDA(secondaryLock);
				const [delegate] = getAutoVoteDelegatePDA(secondaryLock);
				const enrolled = await vesolveAccount
					.autoVoteEnrollment(program)
					.fetchNullable(enrollment);
				const chosenVoter = await vesolveAccount
					.autoVoteDelegate(program)
					.fetchNullable(delegate);
				const tx = new Transaction();
				if (chosenVoter) {
					tx.add(
						await program.methods
							.clearAutoVoter(new BN(source.identifier.toString()))
							.accounts({ owner: publicKey, lock: secondaryLock, delegate })
							.instruction(),
					);
				}
				if (enrolled) {
					// Close the source delegation before burning its lock; the destination keeps its own setting.
					tx.add(
						await program.methods
							.revokeAutoVote(new BN(source.identifier.toString()))
							.accounts({ owner: publicKey, lock: secondaryLock, enrollment })
							.instruction(),
					);
				}
				tx.add(
					await program.methods
						.mergeLock(new BN(targetId), new BN(source.identifier.toString()))
						.accounts({
							user: publicKey,
							protocol: protocolAddress,
							primaryLock,
							secondaryLock,
							secondaryVeMint: secondary.veMint,
							secondaryVeTokenAccount: getAssociatedTokenAddressSync(
								secondary.veMint,
								publicKey,
							),
							tokenProgram: TOKEN_PROGRAM_ID,
						})
						.instruction(),
				);
				await send(tx);
				merged++;
			}

			setOpened(false);
			setMessage(
				`Claimed ${claimed} reward item${claimed === 1 ? "" : "s"}, locked ${formatSolv3(locked)} SOLV3 into veNFT #${targetId}, merged ${merged} veNFT${merged === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} with active votes or changed ownership` : ""}.`,
			);
		} catch (error) {
			setOpened(false);
			setMessage(
				`Claimed ${claimed}, locked ${formatSolv3(locked)} SOLV3, merged ${merged}. ${error instanceof Error ? error.message : "The operation stopped."}`,
			);
		} finally {
			setBusy(false);
			await Promise.allSettled([
				queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-vote-rewards"] }),
				queryClient.invalidateQueries({
					queryKey: ["partner-lock-enrollments"],
				}),
				queryClient.invalidateQueries({
					queryKey: ["vesolve-auto-vote-enrollment"],
				}),
				queryClient.invalidateQueries({
					queryKey: ["totalClaimableRewardsQuote"],
				}),
				queryClient.invalidateQueries({ queryKey: ["token-balances"] }),
			]);
		}
	};

	return (
		<>
			{target && (
				<Button
					component={Link}
					href={`/lock/auto-vote?lockId=${target.identifier.toString()}`}
					variant="subtle"
					fullWidth
				>
					Manage Auto-Vote for veNFT #{target.identifier.toString()}
				</Button>
			)}
			<Button
				size="md"
				radius={12}
				fullWidth
				variant="light"
				disabled={
					!publicKey ||
					!target ||
					locksLoading ||
					voteLoading ||
					lpLoading ||
					busy
				}
				onClick={() => setOpened(true)}
			>
				Claim all, lock &amp; merge
			</Button>
			{!target && publicKey && (
				<Text size="xs" c="dimmed">
					Create a veNFT lock before using this action.
				</Text>
			)}
			{message && (
				<Text size="sm" role="status">
					{message}
				</Text>
			)}
			<Modal
				opened={opened}
				onClose={() => !busy && setOpened(false)}
				title="Claim, lock and merge"
				centered
				closeOnEscape={!busy}
				closeOnClickOutside={!busy}
			>
				<Stack gap="sm">
					<Text size="sm">
						Claim all liquidity and voting rewards. Lock up to the newly claimed
						SOLV3 into your largest veNFT
						{target ? ` #${target.identifier.toString()}` : ""}, then merge
						other eligible veNFTs into it. Merging burns each source veNFT and
						keeps the destination's Auto-Vote setting.
					</Text>
					<Text size="sm">
						A veNFT that voted this epoch cannot merge yet. An Auto-Vote
						enrollment and chosen voter on a merged source are cleared in the
						same transaction. Your wallet may request several approvals;
						completed steps cannot be undone by canceling a later step.
					</Text>
					<Button loading={busy} disabled={!target} onClick={() => void run()}>
						Confirm claim, lock &amp; merge
					</Button>
				</Stack>
			</Modal>
		</>
	);
};
