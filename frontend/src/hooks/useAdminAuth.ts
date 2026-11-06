import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback } from "react";
import { encodeAdminPayload, toHex } from "@/lib/adminAuthPayload";

const ADMIN_AUTH_MESSAGE_PREFIX = "solve3 admin action:";

/**
 * Produces a wallet-signed proof of identity for admin API routes — mirrors
 * @/lib/server/requireAdmin's expected {wallet, message, signature} shape.
 * The signed message binds the action name, a timestamp, and a hash of the
 * actual request payload, so a captured signature can't be replayed against
 * a different action, different parameters for the same action, or (past
 * its short expiry) the exact same call again.
 */
export const useAdminAuth = () => {
	const { publicKey, signMessage } = useWallet();

	const sign = useCallback(
		async (action: string, payload: unknown = {}) => {
			if (!publicKey) throw new Error("Connect Wallet");
			if (!signMessage) {
				throw new Error("This wallet doesn't support message signing");
			}
			const timestamp = Date.now();
			const digest = await crypto.subtle.digest(
				"SHA-256",
				encodeAdminPayload(payload) as BufferSource,
			);
			const payloadHash = toHex(digest);
			const message = `${ADMIN_AUTH_MESSAGE_PREFIX} ${action} | ${timestamp} | ${payloadHash}`;
			const signatureBytes = await signMessage(
				new TextEncoder().encode(message),
			);
			return {
				wallet: publicKey.toString(),
				message,
				signature: Buffer.from(signatureBytes).toString("base64"),
			};
		},
		[publicKey, signMessage],
	);

	return { sign };
};
