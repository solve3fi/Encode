import { useLingui } from "@lingui/react";
import { BN } from "@coral-xyz/anchor";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

export type SplitLockInput = {
	veTokenId: number;
	amount: BN;
};

/**
 * Splits part of an existing permanent lock off into a brand-new lock/veNFT.
 * split_lock mints exactly one new lock per call and requires
 * 0 < amount < ve_lock.amount (programs/vesolve/src/instructions/split_lock.rs).
 */
export const useSplitLock = () => {
	const { i18n } = useLingui();
	const { publicKey } = useWallet();
	const program = useVesolveProgram();
	const queryClient = useQueryClient();

	return useMutation({
		mutationKey: ["vesolve-split-lock"],
		mutationFn: async ({ veTokenId, amount }: SplitLockInput) => {
			if (!publicKey) throw new Error(i18n._("Connect Wallet"));

			const [protocolAddress] = getProtocolPDA();
			const protocol = await vesolveAccount
				.protocol(program)
				.fetch(protocolAddress);
			const newLockId = BigInt(protocol.nextNftTokenId.toString());

			const [veLock] = getLockPDA(veTokenId);
			const source = await vesolveAccount.lock(program).fetch(veLock);
			const veLockTokenAccount = getAssociatedTokenAddressSync(
				source.veMint,
				publicKey,
			);

			const [lockAddress] = getLockPDA(newLockId);
			const [veMint] = getVeMintPDA(newLockId);
			const veTokenAccount = getAssociatedTokenAddressSync(veMint, publicKey);
			const [metadata] = getMetadataPDA(veMint);

			const signature = await program.methods
				.splitLock(new BN(veTokenId), amount)
				.accounts({
					user: publicKey,
					protocol: protocolAddress,
					veLock,
					veLockMint: source.veMint,
					veLockTokenAccount,
					lock: lockAddress,
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

			await program.provider.connection.confirmTransaction(
				signature,
				"confirmed",
			);

			return { signature, newLockId: newLockId.toString() };
		},
		onSuccess: async (_, { veTokenId }) => {
			notification.success({
				title: i18n._("Split Lock"),
				message: i18n._("Lock split successfully"),
			});
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["vesolve-locks"] }),
				queryClient.invalidateQueries({ queryKey: ["vesolve-lock", veTokenId] }),
			]);
		},
		onError: (error) => {
			console.error(error);
			notification.error({
				title: i18n._("Split Lock"),
				message:
					error instanceof Error && error.message
						? error.message
						: i18n._("Split failed!"),
			});
		},
	});
};
