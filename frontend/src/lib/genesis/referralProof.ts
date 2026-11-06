import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";

const MAX_PROOF_AGE_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;

export function genesisReferralMessage(input: {
	campaignId: string;
	refereeWallet: string;
	referrerWallet: string;
	issuedAtMs: number;
}): string {
	return [
		"Solve3 Genesis referral attribution v1",
		`campaign_id=${input.campaignId}`,
		`referee_wallet=${input.refereeWallet}`,
		`referrer_wallet=${input.referrerWallet}`,
		`issued_at_ms=${input.issuedAtMs}`,
	].join("\n");
}

/** Only a recent signature from the referee can authorize first attribution. */
export function verifyGenesisReferralProof(
	input: {
		campaignId: string;
		refereeWallet: string;
		referrerWallet: string;
		issuedAtMs: number;
		message: string;
		signatureBase64: string;
	},
	nowMs = Date.now(),
): boolean {
	const {
		campaignId,
		refereeWallet,
		referrerWallet,
		issuedAtMs,
		message,
		signatureBase64,
	} = input;
	if (
		!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(campaignId) ||
		!Number.isSafeInteger(issuedAtMs) ||
		!Number.isSafeInteger(nowMs) ||
		issuedAtMs > nowMs + MAX_CLOCK_SKEW_MS ||
		nowMs - issuedAtMs > MAX_PROOF_AGE_MS ||
		!signatureBase64 ||
		message !==
			genesisReferralMessage({
				campaignId,
				refereeWallet,
				referrerWallet,
				issuedAtMs,
			})
	)
		return false;
	try {
		const referee = new PublicKey(refereeWallet);
		const referrer = new PublicKey(referrerWallet);
		if (
			referee.toBase58() !== refereeWallet ||
			referrer.toBase58() !== referrerWallet ||
			referee.equals(referrer)
		)
			return false;
		const signature = Buffer.from(signatureBase64, "base64");
		return (
			signature.length === 64 &&
			nacl.sign.detached.verify(
				new TextEncoder().encode(message),
				signature,
				referee.toBytes(),
			)
		);
	} catch {
		return false;
	}
}
