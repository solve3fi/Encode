import "server-only";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { isVesolveAdmin } from "@/configs/admins";
import { encodeAdminPayload } from "@/lib/adminAuthPayload";
import { verifyWalletSignature } from "./verifyWalletSignature";

export const ADMIN_AUTH_MESSAGE_PREFIX = "solve3 admin action:";

// Generous enough for a wallet popup + slow network, tight enough that a
// captured signature stops working shortly after — see the comment below on
// why a signature must expire even when its payload hash still matches.
const ADMIN_AUTH_MAX_AGE_MS = 5 * 60_000;

export type AdminAuthPayload = {
	wallet: string;
	message: string;
	signature: string;
};

/**
 * Verifies an admin-gated API request. The signed message must bind all of:
 * the expected action name, a recent timestamp, and a hash of the actual
 * request payload — so a signature captured off the wire (logs, a proxy, a
 * curious teammate) can't be replayed against a different action, replayed
 * with different parameters for the same action, or replayed indefinitely
 * for the exact same call. The signature itself must be valid for the
 * claimed wallet, and that wallet must be in the vesolve admin allowlist.
 * Throws with a client-safe message on any failure.
 */
export const requireAdmin = (
	{ wallet, message, signature }: AdminAuthPayload,
	expectedAction: string,
	payload: unknown = {},
): PublicKey => {
	const parts = message.split(" | ");
	if (parts.length !== 3) {
		throw new Error("Invalid auth message");
	}
	const [actionPart, timestampPart, hashPart] = parts;
	if (actionPart !== `${ADMIN_AUTH_MESSAGE_PREFIX} ${expectedAction}`) {
		throw new Error("Invalid auth message");
	}

	const timestamp = Number(timestampPart);
	if (
		!Number.isFinite(timestamp) ||
		Math.abs(Date.now() - timestamp) > ADMIN_AUTH_MAX_AGE_MS
	) {
		throw new Error("Auth message expired");
	}

	const expectedHash = createHash("sha256")
		.update(encodeAdminPayload(payload))
		.digest("hex");
	if (hashPart !== expectedHash) {
		throw new Error("Auth message does not match request payload");
	}

	if (!verifyWalletSignature(wallet, message, signature)) {
		throw new Error("Invalid signature");
	}
	const publicKey = new PublicKey(wallet);
	if (!isVesolveAdmin(publicKey)) {
		throw new Error("Not authorized");
	}
	return publicKey;
};
