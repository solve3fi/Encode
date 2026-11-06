import "server-only";
import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";

// No prior pattern in this repo for encrypting a secret added at runtime
// (faucetSigner.ts's key comes straight from an env var, never touched by
// user input) — this is deliberately a new, self-contained primitive rather
// than storing pasted wallet secret keys in the plain JSON data store.
const getKey = (): Buffer => {
	const raw = process.env.WALLET_CONFIG_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			"WALLET_CONFIG_ENCRYPTION_KEY is not set — add it to .env.local",
		);
	}
	return scryptSync(raw, "solve3-admin-auto-vote-wallets", 32);
};

export type EncryptedSecret = {
	iv: string;
	authTag: string;
	ciphertext: string;
};

export const encryptSecret = (plaintext: string): EncryptedSecret => {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return {
		iv: iv.toString("base64"),
		authTag: cipher.getAuthTag().toString("base64"),
		ciphertext: ciphertext.toString("base64"),
	};
};

export const decryptSecret = (encrypted: EncryptedSecret): string => {
	const decipher = createDecipheriv(
		"aes-256-gcm",
		getKey(),
		Buffer.from(encrypted.iv, "base64"),
	);
	decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
		decipher.final(),
	]);
	return plaintext.toString("utf8");
};
