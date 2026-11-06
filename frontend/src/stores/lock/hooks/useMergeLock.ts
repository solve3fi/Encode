import { useLingui } from "@lingui/react";
import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getLockPDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";

export type MergeLockInput = {
	primaryVeTokenId: number;
	secondaryVeTokenId: number;
};

/**
 * Merges `secondaryVeTokenId` into `primaryVeTokenId`: the primary lock's
 * amount/voting power absorb the secondary's, and the secondary lock/veNFT
 * is burned and closed. Requires the two locks share an owner
 * (programs/vesolve/src/instructions/merge_lock.rs, Lock::can_merge_with).
 */
export const useMergeLock = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-merge-lock"],
		mutationFn: async ({
			primaryVeTokenId,
			secondaryVeTokenId,
		}: MergeLockInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));
			if (primaryVeTokenId === secondaryVeTokenId) {
				throw new Error(i18n._("Pick two different locks to merge"));
			}

			const [protocolAddress] = getProtocolPDA();
			const [primaryLock] = getLockPDA(primaryVeTokenId);
			const [secondaryLock] = getLockPDA(secondaryVeTokenId);
			const secondary = await vesolveAccount
				.lock(program)
				.fetch(secondaryLock);
			const secondaryVeTokenAccount = getAssociatedTokenAddressSync(
				secondary.veMint,
				publicKey,
			);

			const signature = await program.methods
				.mergeLock(new BN(primaryVeTokenId), new BN(secondaryVeTokenId))
				.accounts({
					user: publicKey,
					protocol: protocolAddress,
					primaryLock,
					secondaryLock,
					secondaryVeMint: secondary.veMint,
					secondaryVeTokenAccount,
					tokenProgram: TOKEN_PROGRAM_ID,
				})
				.rpc();

			await program.provider.connection.confirmTransaction(
				signature,
				"confirmed",
			);

			return { signature };
		},
		onSuccess: async (_, { primaryVeTokenId, secondaryVeTokenId }) => {
			notification.success({
				title: i18n._("Merge Locks"),
				message: i18n._("Locks merged successfully"),
			});
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] }),
				queryClient.invalidateQueries({
					queryKey: ["vesolve-lock", primaryVeTokenId],
				}),
				queryClient.invalidateQueries({
					queryKey: ["vesolve-lock", secondaryVeTokenId],
				}),
			]);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Merge Locks"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Merge failed!"),
			});
		},
	});
};
