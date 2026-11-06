import "server-only";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

/**
 * Verifies a wallet-signed message server-side — the standard "sign-in with
 * wallet" proof-of-ownership pattern. Used to gate admin-only API routes
 * (the client signs a message with their connected wallet; the server
 * checks the signature is valid for the claimed pubkey before trusting who
 * they say they are).
 */
export const verifyWalletSignature = (
	walletAddress: string,
	message: string,
	signatureBase64: string,
): boolean => {
	try {
		const publicKey = new PublicKey(walletAddress);
		const messageBytes = new TextEncoder().encode(message);
		const signatureBytes = Buffer.from(signatureBase64, "base64");
		return nacl.sign.detached.verify(
			messageBytes,
			signatureBytes,
			publicKey.toBytes(),
		);
	} catch {
		return false;
	}
};
