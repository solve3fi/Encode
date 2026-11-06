import { assertPassportId } from "./passport-id.mjs";

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function timestamp(value, field) {
	if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
		throw new TypeError(`wallet link: ${field} must be a timestamp`);
	}
	return Date.parse(value);
}

/**
 * Resolve a finalized event against a complete wallet history snapshot.
 * This is a pure read helper, not a signature verifier or award writer.
 * Missing history and pre-link activity resolve to null.
 */
export function passportAtEvent({ network, wallet, eventAt, links }) {
	if (network !== "DEVNET" || typeof wallet !== "string" || !WALLET.test(wallet)) {
		throw new TypeError("wallet link: expected a Devnet base58 wallet");
	}
	const eventMs = timestamp(eventAt, "eventAt");
	if (!Array.isArray(links)) {
		throw new TypeError("wallet link: complete history array is required");
	}
	let previousEnd = Number.NEGATIVE_INFINITY;
	let historicalPassportId = null;
	let attributed = null;
	for (const link of [...links].sort((a, b) =>
		timestamp(a.linkedAt, "linkedAt") - timestamp(b.linkedAt, "linkedAt"),
	)) {
		if (link?.network !== network || link.wallet !== wallet) {
			throw new Error("wallet link: history contains a different network or wallet");
		}
		const passportId = assertPassportId(link.passportId);
		if (historicalPassportId !== null && historicalPassportId !== passportId) {
			throw new Error("wallet link: history changes Passport ownership");
		}
		historicalPassportId = passportId;
		const start = timestamp(link.linkedAt, "linkedAt");
		const end = link.unlinkedAt === null ? Number.POSITIVE_INFINITY : timestamp(link.unlinkedAt, "unlinkedAt");
		if (end <= start || start < previousEnd) {
			throw new Error("wallet link: invalid or overlapping history");
		}
		previousEnd = end;
		if (start <= eventMs && eventMs < end) {
			attributed = passportId;
		}
	}
	return attributed;
}
