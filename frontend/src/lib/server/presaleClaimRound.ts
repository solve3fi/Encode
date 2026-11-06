import "server-only";

/**
 * Presale claims come in two rounds with separate ledgers: round 1 is the Friends & Family list (presale-allocations,
 * uploaded and activated by an admin) and round 2 is the public sale (presale-round2-allocations, published from the
 * sale ledger in Admin > Presale once the sale is over). The claim, finalize and status routes take an optional
 * `round`; without one they serve round 1 exactly as before.
 */
export type PresaleRound = 1 | 2;

export const ROUND2_CLAIM_STORE = "presale-round2-allocations";

/** Round from a request field: absent means 1; anything other than 1 or 2 is refused (null). */
export function parsePresaleRound(value: unknown): PresaleRound | null {
	if (value === undefined || value === null || value === 1 || value === "1")
		return 1;
	if (value === 2 || value === "2") return 2;
	return null;
}

export const claimStoreFor = (round: PresaleRound) =>
	round === 2 ? ROUND2_CLAIM_STORE : "presale-allocations";

/** The in-flight guard key: round 2 has its own so a wallet in both rounds can claim each. */
export const claimFlightKey = (round: PresaleRound, address: string) =>
	round === 2 ? `presale-round2:${address}` : address;
