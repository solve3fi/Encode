import { BN } from "@coral-xyz/anchor";
import { useLingui } from "@lingui/react";
import { type PublicKey, SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getEpochPDA,
	getGaugePDA,
	getLockPDA,
	getProtocolPDA,
	getUserVotePDA,
	getVoteLockRecordPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { retryIfExpired } from "@/lib/retryExpired";

export type CreateVoteInput = {
	lockId: number;
	authority: PublicKey;
	pools: PublicKey[];
	powers: number[];
};

export const useCreateVote = () => {
	const { i18n } = useLingui();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-vote"],
		mutationFn: async ({
			lockId,
			authority,
			pools,
			powers,
		}: CreateVoteInput) => {
			if (pools.length === 0) throw new Error("Invalid data");
			if (pools.length !== powers.length) throw new Error("Invalid data");
			if (
				powers.some(
					(power) => !Number.isInteger(power) || power < 0 || power > 100,
				) ||
				powers.reduce((total, power) => total + power, 0) > 100
			) {
				throw new Error("Vote allocation cannot exceed 100%");
			}

			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(protocolAddress);
			const currentEpoch = protocol.currentEpoch.toNumber();

			const [lockAddress] = getLockPDA(lockId);
			const [epochAddress] = getEpochPDA(currentEpoch);
			const [userVoteAddress] = getUserVotePDA(lockAddress, currentEpoch);
			const [voteLockRecordAddress] = getVoteLockRecordPDA(
				lockAddress,
				currentEpoch,
			);

			const gaugeAddresses = pools.map(
				(pool) => getGaugePDA(protocolAddress, pool)[0],
			);
			const gaugeVotes = gaugeAddresses.map((gauge, i) => ({
				gauge,
				// VOTE_WEIGHT_PRECISION on-chain is 100 (i.e. a plain percentage).
				weight: new BN(Math.round(powers[i])),
			}));

			const signature = await retryIfExpired(() =>
				program.methods
				.vote(new BN(lockId), gaugeVotes)
				.accounts({
					user: authority,
					protocol: protocolAddress,
					epoch: epochAddress,
					lock: lockAddress,
					userVote: userVoteAddress,
					voteLockRecord: voteLockRecordAddress,
					// Optional accounts are only for the auto-vote keeper / allocation
					// voters acting for a lock; the owner voting directly passes none.
					// Anchor requires an explicit null rather than omitting them (the
					// untyped Program's accounts type cannot express that, hence the cast).
					autoVoteEnrollment: null,
					allocationVoter: null,
					systemProgram: SystemProgram.programId,
				} as never)
				.remainingAccounts(
					gaugeAddresses.map((pubkey) => ({
						pubkey,
						isWritable: false,
						isSigner: false,
					})),
				)
				.rpc(),
			);

			await program.provider.connection.confirmTransaction(
				signature,
				"confirmed",
			);

			return signature;
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Vote"),
				message: i18n._("Vote cast successfully!"),
			});
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["vesolve-epoch"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-votes"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-lock"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-user-vote"] }),
			]);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Vote"),
				message: i18n._("Vote failed!"),
			});
		},
	});
};
