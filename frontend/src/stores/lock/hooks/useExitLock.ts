import { useLingui } from "@lingui/react";
import { BN } from "@coral-xyz/anchor";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getExitConfigPDA,
	getLockPDA,
	getProtocolPDA,
	getVeMintPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";

export type ExitLockInput = {
	veTokenId: number;
	/**
	 * SOLV3 base units to exit. Omit to exit the whole lock (closes it);
	 * a smaller amount leaves the rest permanently locked.
	 */
	partialAmount?: BN;
};

/**
 * Exits a permanent lock: pays EXIT_FEE_BPS of the position's published
 * market value in SOL to the protocol treasury and receives the full SOLV3
 * principal back. The lock and its veNFT are burned/closed
 * (programs/vesolve/src/instructions/exit_lock.rs). With `partialAmount` it calls
 * partial_exit_lock instead: the fee applies only to that amount and the rest
 * of the lock stays locked.
 */
export const useExitLock = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-exit-lock"],
		mutationFn: async ({ veTokenId, partialAmount }: ExitLockInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(protocolAddress);
			const [exitConfigAddress] = getExitConfigPDA();
			const [lockAddress] = getLockPDA(veTokenId);
			const [veMint] = getVeMintPDA(veTokenId);

			const userTokenAccount = getAssociatedTokenAddressSync(
				protocol.tokenMint,
				publicKey,
			);
			const protocolTokenAccount = getAssociatedTokenAddressSync(
				protocol.tokenMint,
				protocolAddress,
				true,
			);
			const veTokenAccount = getAssociatedTokenAddressSync(veMint, publicKey);

			if (partialAmount) {
				const partialSignature = await program.methods
					.partialExitLock(new BN(veTokenId), partialAmount)
					.accounts({
						user: publicKey,
						protocol: protocolAddress,
						exitConfig: exitConfigAddress,
						lock: lockAddress,
						userTokenAccount,
						tokenMint: protocol.tokenMint,
						protocolTokenAccount,
						systemProgram: SystemProgram.programId,
						tokenProgram: TOKEN_PROGRAM_ID,
					})
					.rpc();
				await program.provider.connection.confirmTransaction(
					partialSignature,
					"confirmed",
				);
				return { signature: partialSignature };
			}

			const signature = await program.methods
				.exitLock(new BN(veTokenId))
				.accounts({
					user: publicKey,
					protocol: protocolAddress,
					exitConfig: exitConfigAddress,
					lock: lockAddress,
					userTokenAccount,
					tokenMint: protocol.tokenMint,
					protocolTokenAccount,
					veMint,
					veTokenAccount,
					systemProgram: SystemProgram.programId,
					tokenProgram: TOKEN_PROGRAM_ID,
					associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				})
				.rpc();

			await program.provider.connection.confirmTransaction(
				signature,
				"confirmed",
			);

			return { signature };
		},
		onSuccess: async (_, { veTokenId }) => {
			notification.success({
				title: i18n._("Exit Lock"),
				message: i18n._("SOLV3 returned to your wallet"),
			});
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-lock", veTokenId] }),
			]);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Exit Lock"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Exit failed!"),
			});
		},
	});
};
