import "server-only";
import {
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
	Keypair,
	PublicKey,
	Transaction,
	type Connection,
} from "@solana/web3.js";
import { AIRDROP_TOKEN_DECIMALS, AIRDROP_TOKEN_MINT } from "@/configs/airdrop";

/**
 * Transfers `amount` (raw units) of the airdrop's SOLV3 mint from
 * `authority`'s own token account to `recipient`, creating the recipient's
 * ATA first if needed. This is a plain SPL transfer, not a mint — vesolve's
 * Protocol.token_mint's mint authority is a program PDA (only vesolve
 * itself can sign for it, for emission distribution), so the airdrop draws
 * down the devnet admin wallet's own existing balance instead. See
 * @/configs/airdrop.ts for why this is a different mint than the `token`
 * program's.
 */
export const transferSolveTo = async (
	connection: Connection,
	authority: Keypair,
	recipient: PublicKey,
	amount: bigint,
): Promise<string> => {
	const authorityAta = getAssociatedTokenAddressSync(
		AIRDROP_TOKEN_MINT,
		authority.publicKey,
	);
	const recipientAta = getAssociatedTokenAddressSync(AIRDROP_TOKEN_MINT, recipient);

	const tx = new Transaction().add(
		createAssociatedTokenAccountIdempotentInstruction(
			authority.publicKey,
			recipientAta,
			recipient,
			AIRDROP_TOKEN_MINT,
		),
		createTransferCheckedInstruction(
			authorityAta,
			AIRDROP_TOKEN_MINT,
			recipientAta,
			authority.publicKey,
			amount,
			AIRDROP_TOKEN_DECIMALS,
		),
	);

	const signature = await connection.sendTransaction(tx, [authority]);
	await connection.confirmTransaction(signature, "confirmed");
	return signature;
};
