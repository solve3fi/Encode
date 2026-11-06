import type { Idl, Program } from "@coral-xyz/anchor";
import { useLingui } from "@lingui/react";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	type PublicKey,
	SystemProgram,
	Transaction,
	type TransactionInstruction,
} from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import BN from "bn.js";
import { notification } from "@/components/Notifications";
import {
	getAutoVoteEnrollmentPDA,
	getBribeTokenPDA,
	getLockPDA,
	getProtocolPDA,
	getUserBribeRewardsPDA,
	getUserPoolRewardsPDA,
	getUserRewardsPDA,
	getUserVotePDA,
	getVaultPDA,
	getVoteLockRecordPDA,
	useVesolveProgram,
} from "@/hooks/useVesolveProgram";
import type { ClaimableVoteReward } from "@/hooks/useVoteRewards";

/** Builds every claim instruction (reward + pool reward + each bribe) a
 * single claimable row still has outstanding. Exported standalone (not a
 * hook) so both the per-row claim button and "Claim All Rewards" can share
 * it without going through two different mutations. */
export const buildVoteRewardClaimIxs = async (
	// biome-ignore lint/suspicious/noExplicitAny: Program<Idl> loses the
	// generated method names; this file only calls dynamically-named methods.
	program: Program<Idl> | any,
	user: PublicKey,
	row: ClaimableVoteReward,
): Promise<TransactionInstruction[]> => {
	const [protocolAddress] = getProtocolPDA();
	const [lockAddress] = getLockPDA(row.veTokenId);
	const [autoVoteEnrollment] = getAutoVoteEnrollmentPDA(lockAddress);
	const [vaultAddress] = getVaultPDA(row.epoch, row.gauge);
	const [userVoteAddress] = getUserVotePDA(lockAddress, row.epoch);
	const [voteLockRecordAddress] = getVoteLockRecordPDA(lockAddress, row.epoch);
	const ixs: TransactionInstruction[] = [];
	// u64 instruction arguments must be BN: a plain number fails inside Anchor ("src.toArrayLike is not a function").
	const veTokenId = new BN(row.veTokenId);

	if (row.rewardAmount.gtn(0)) {
		const [userRewardsPDA] = getUserRewardsPDA(
			lockAddress,
			row.epochAddress,
			row.gauge,
		);
		const userTokenAccount = getAssociatedTokenAddressSync(
			row.rewardMint,
			user,
		);
		const vaultTokenAccount = getAssociatedTokenAddressSync(
			row.rewardMint,
			vaultAddress,
			true,
		);
		ixs.push(
			await program.methods
				.claimReward(veTokenId)
				.accounts({
					user,
					protocol: protocolAddress,
					lock: lockAddress,
					gauge: row.gauge,
					epoch: row.epochAddress,
					vault: vaultAddress,
					tokenMint: row.rewardMint,
					userTokenAccount,
					vaultTokenAccount,
					userRewards: userRewardsPDA,
					userVote: userVoteAddress,
					systemProgram: SystemProgram.programId,
					tokenProgram: TOKEN_PROGRAM_ID,
					associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				})
				.instruction(),
		);
	}

	if (row.poolRewardAmountA.gtn(0) || row.poolRewardAmountB.gtn(0)) {
		const [userPoolRewardsPDA] = getUserPoolRewardsPDA(
			lockAddress,
			row.epochAddress,
			row.gauge,
		);
		const userTokenAccountA = getAssociatedTokenAddressSync(
			row.tokenMintA,
			user,
		);
		const userTokenAccountB = getAssociatedTokenAddressSync(
			row.tokenMintB,
			user,
		);
		const vaultTokenAccountA = getAssociatedTokenAddressSync(
			row.tokenMintA,
			vaultAddress,
			true,
		);
		const vaultTokenAccountB = getAssociatedTokenAddressSync(
			row.tokenMintB,
			vaultAddress,
			true,
		);
		const treasuryTokenAccountA = getAssociatedTokenAddressSync(
			row.tokenMintA,
			protocolAddress,
			true,
		);
		const treasuryTokenAccountB = getAssociatedTokenAddressSync(
			row.tokenMintB,
			protocolAddress,
			true,
		);
		ixs.push(
			await program.methods
				.claimPoolReward(
					veTokenId,
					(row.poolRewardAmountA.gtn(0) ? 1 : 0) |
						(row.poolRewardAmountB.gtn(0) ? 2 : 0),
				)
				.accounts({
					user,
					protocol: protocolAddress,
					lock: lockAddress,
					autoVoteEnrollment,
					gauge: row.gauge,
					epoch: row.epochAddress,
					vault: vaultAddress,
					tokenMintA: row.tokenMintA,
					userTokenAccountA,
					vaultTokenAccountA,
					tokenMintB: row.tokenMintB,
					userTokenAccountB,
					vaultTokenAccountB,
					treasuryTokenAccountA,
					treasuryTokenAccountB,
					userRewards: userPoolRewardsPDA,
					userVote: userVoteAddress,
					voteLockRecord: voteLockRecordAddress,
					systemProgram: SystemProgram.programId,
					tokenProgram: TOKEN_PROGRAM_ID,
					associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				})
				.remainingAccounts([
					{ pubkey: row.partnerVoter, isSigner: false, isWritable: false },
				])
				.instruction(),
		);
	}

	for (const bribe of row.bribes) {
		if (!bribe.amount.gtn(0)) continue;
		const [userBribeRewardsPDA] = getUserBribeRewardsPDA(
			lockAddress,
			row.epochAddress,
			row.gauge,
			bribe.mint,
		);
		const userTokenAccount = getAssociatedTokenAddressSync(bribe.mint, user);
		const bribeVaultTokenAccount = getAssociatedTokenAddressSync(
			bribe.mint,
			vaultAddress,
			true,
		);
		const treasuryTokenAccount = getAssociatedTokenAddressSync(
			bribe.mint,
			protocolAddress,
			true,
		);
		ixs.push(
			await program.methods
				.claimBribeReward(veTokenId)
				.accounts({
					user,
					protocol: protocolAddress,
					lock: lockAddress,
					autoVoteEnrollment,
					gauge: row.gauge,
					epoch: row.epochAddress,
					vault: vaultAddress,
					tokenMint: bribe.mint,
					bribeToken: getBribeTokenPDA(bribe.mint)[0],
					userTokenAccount,
					bribeVaultTokenAccount,
					treasuryTokenAccount,
					userRewards: userBribeRewardsPDA,
					userVote: userVoteAddress,
					voteLockRecord: voteLockRecordAddress,
					systemProgram: SystemProgram.programId,
					tokenProgram: TOKEN_PROGRAM_ID,
					associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				})
				.remainingAccounts([
					{ pubkey: row.partnerVoter, isSigner: false, isWritable: false },
				])
				.instruction(),
		);
	}

	return ixs;
};

export const useClaimVoteReward = () => {
	const { i18n } = useLingui();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["claimVoteReward"],
		mutationFn: async ({
			user,
			row,
		}: {
			user: PublicKey;
			row: ClaimableVoteReward;
		}) => {
			const ixs = await buildVoteRewardClaimIxs(program, user, row);
			if (ixs.length === 0) return null;
			const transaction = new Transaction().add(...ixs);
			const signature = await program.provider.sendAndConfirm?.(transaction);
			if (!signature) throw new Error("Wallet not connected");
			return signature;
		},
		onSuccess: async (signature) => {
			if (!signature) return;
			notification.success({
				title: i18n._("Voting Rewards"),
				message: i18n._("Rewards claimed!"),
			});
			await queryClient.invalidateQueries({
				queryKey: ["vesolve-vote-rewards"],
			});
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Voting Rewards"),
				message: i18n._("Claim failed!"),
			});
		},
	});
};
