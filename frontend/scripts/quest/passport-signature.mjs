import bs58 from "bs58";
import nacl from "tweetnacl";

/**
 * Quest Passport wallet signature verification.
 *
 * Dormant, production-equivalent Ed25519 (EdDSA) verifier for the Passport
 * proof-of-ownership message. This mirrors `verifyWalletSignature` from
 * `src/lib/server/verifyWalletSignature.ts` — same library (tweetnacl) and
 * same algorithm (detached Ed25519 verification over the UTF-8 encoded
 * message) — and shares its `(wallet, message, signatureBase64) => boolean`
 * shape. When the Passport server route ships, inject that utility directly
 * instead of importing this module, since the shapes are identical.
 *
 * Pure and dormant: no network, filesystem, or database access. It never
 * throws — decode errors, wrong key/signature lengths, and invalid
 * signatures all return `false`.
 */

/**
 * Verify that `signatureBase64` is a valid Ed25519 signature over `message`
 * made by the wallet whose base58-encoded public key is `wallet`.
 *
 * @param {string} wallet Base58-encoded 32-byte Solana wallet public key.
 * @param {string} message Exact message string the wallet signed.
 * @param {string} signatureBase64 Base64-encoded 64-byte detached signature.
 * @returns {boolean} `true` only when the signature is valid for this exact
 *   wallet and message; `false` for any decode error, wrong length, or
 *   invalid signature (never throws).
 */
export const verifyPassportSignature = (wallet, message, signatureBase64) => {
	try {
		if (
			typeof wallet !== "string" ||
			typeof message !== "string" ||
			typeof signatureBase64 !== "string"
		) {
			return false;
		}
		const publicKeyBytes = bs58.decode(wallet);
		if (publicKeyBytes.length !== nacl.sign.publicKeyLength) {
			return false;
		}
		const signatureBytes = Buffer.from(signatureBase64, "base64");
		if (signatureBytes.length !== nacl.sign.signatureLength) {
			return false;
		}
		return nacl.sign.detached.verify(
			new TextEncoder().encode(message),
			signatureBytes,
			publicKeyBytes,
		);
	} catch {
		return false;
	}
};
