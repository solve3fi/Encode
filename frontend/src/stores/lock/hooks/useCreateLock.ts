import { useLingui } from "@lingui/react";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import {
	PublicKey,
	SYSVAR_RENT_PUBKEY,
	SystemProgram,
} from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BN } from "@coral-xyz/anchor";
import { notification } from "@/components/Notifications";
import {
	getLockPDA,
	getMetadataPDA,
	getProtocolPDA,
	getVeMintPDA,
	METADATA_PROGRAM_ID,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";

export type CreateLockInput = {
	tokenMint: PublicKey;
	userTokenAccount: PublicKey;
	amount: BN;
};

/**
 * Locks `amount` of the caller's own token balance into a new, permanent
 * veSOLV3 NFT position (create_lock — see
 * programs/vesolve/src/instructions/create_lock.rs). The signer must own
 * `userTokenAccount` and it must hold at least `amount`; the program itself
 * enforces this, this hook just derives the PDAs the instruction needs.
 */
export const useCreateLock = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-create-lock"],
		mutationFn: async ({ tokenMint, userTokenAccount, amount }: CreateLockInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount.protocol(program).fetch(protocolAddress);
			const nextId = BigInt(protocol.nextNftTokenId.toString());

			const [lockAddress] = getLockPDA(nextId);
			const [veMint] = getVeMintPDA(nextId);
			const veTokenAccount = getAssociatedTokenAddressSync(veMint, publicKey);
			const [metadata] = getMetadataPDA(veMint);
			const protocolTokenAccount = getAssociatedTokenAddressSync(
				tokenMint,
				protocolAddress,
				true,
			);

			// unlock_time is ignored on-chain now (locks are permanent) but the
			// instruction still takes the arg — any value satisfies the ABI.
			const unlockTime = new BN(Math.floor(Date.now() / 1000));

			const signature = await program.methods
				.createLock(amount, unlockTime)
				.accounts({
					user: publicKey,
					protocol: protocolAddress,
					lock: lockAddress,
					userTokenAccount,
					tokenMint,
					protocolTokenAccount,
					veMint,
					veTokenAccount,
					metadata,
					systemProgram: SystemProgram.programId,
					tokenProgram: TOKEN_PROGRAM_ID,
					associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
					metadataProgram: METADATA_PROGRAM_ID,
					rent: SYSVAR_RENT_PUBKEY,
				})
				.rpc();

			await program.provider.connection.confirmTransaction(signature, "confirmed");
			return signature;
		},
		onSuccess: async () => {
			notification.success({
				title: i18n._("Lock"),
				message: i18n._("Locked into a permanent veSOLV3 position"),
			});
			await queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] });
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Lock"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Lock failed"),
			});
		},
	});
};
