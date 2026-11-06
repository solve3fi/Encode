import { BN } from "@coral-xyz/anchor";
import { useLingui } from "@lingui/react";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountIdempotentInstruction,
	createCloseAccountInstruction,
	createSyncNativeInstruction,
	getAssociatedTokenAddressSync,
	NATIVE_MINT,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type PublicKey, SystemProgram } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import {
	getBribePDA,
	getBribeTokenPDA,
	getEpochPDA,
	getGaugePDA,
	getProtocolPDA,
	getVaultPDA,
	useVesolveProgram,
} from "@/hooks/useVesolveProgram";
import { retryIfExpired } from "@/lib/retryExpired";

export type CreateBribeInput = {
	authority: PublicKey;
	pool: PublicKey;
	mintToken: PublicKey;
	epoch: number;
	amount: BN;
};

/**
 * Anyone can fund a bribe for any gauge (create_bribe — see
 * programs/vesolve/src/instructions/create_bribe.rs); this just derives the
 * PDAs the real vesolve program needs. Previously wired to useVeClient,
 * which points at a program id that isn't deployed on devnet at all, so
 * every "Add Bribe" submission failed before reaching the chain.
 */
export const useCreateBribe = () => {
	const { i18n } = useLingui();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-create-bribe"],
		mutationFn: async ({
			authority,
			pool,
			mintToken,
			epoch,
			amount,
		}: CreateBribeInput) => {
			const [protocolAddress] = getProtocolPDA();
			const [gaugeAddress] = getGaugePDA(protocolAddress, pool);
			const [epochAddress] = getEpochPDA(epoch);
			const [vaultAddress] = getVaultPDA(epoch, gaugeAddress);
			const [bribeAddress] = getBribePDA(gaugeAddress, mintToken, authority);

			// Only allowlisted tokens can be used as incentives. Say so plainly instead of letting
			// the program fail with "AccountNotInitialized" on bribe_token.
			const [bribeTokenAddress] = getBribeTokenPDA(mintToken);
			if (!(await program.provider.connection.getAccountInfo(bribeTokenAddress))) {
				throw new Error(
					i18n._(
						"This token is not approved for voting incentives yet. Choose another token.",
					),
				);
			}

			const userTokenAccount = getAssociatedTokenAddressSync(
				mintToken,
				authority,
			);
			const bribeTokenAccount = getAssociatedTokenAddressSync(
				mintToken,
				vaultAddress,
				true,
			);

			// Native SOL is not an SPL token: wrap it first, deposit, then close the wrapped account so the rent and any
			// leftover lamports return to the wallet. All of it is one transaction, so it either happens fully or not at all.
			const isNativeSol = mintToken.equals(NATIVE_MINT);
			const wrapIxs = isNativeSol
				? [
						createAssociatedTokenAccountIdempotentInstruction(authority, userTokenAccount, authority, NATIVE_MINT),
						SystemProgram.transfer({ fromPubkey: authority, toPubkey: userTokenAccount, lamports: BigInt(amount.toString()) }),
						createSyncNativeInstruction(userTokenAccount),
					]
				: [];
			const unwrapIxs = isNativeSol ? [createCloseAccountInstruction(userTokenAccount, authority, authority)] : [];

			const signature = await retryIfExpired(() =>
				program.methods
				.createBribe(amount)
				.preInstructions(wrapIxs)
				.postInstructions(unwrapIxs)
				.accounts({
					user: authority,
					epoch: epochAddress,
					gauge: gaugeAddress,
					vault: vaultAddress,
					tokenMint: mintToken,
					bribe: bribeAddress,
					userTokenAccount,
					bribeTokenAccount,
					systemProgram: SystemProgram.programId,
					tokenProgram: TOKEN_PROGRAM_ID,
					associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				})
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
				title: i18n._("Bribe"),
				message: i18n._("Bribe added successfully!"),
			});
			await queryClient.invalidateQueries({ queryKey: ["vesolve-votes"] });
			await queryClient.invalidateQueries({ queryKey: ["vesolve-epoch"] });
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Bribe"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Failed to add bribe"),
			});
		},
	});
};
