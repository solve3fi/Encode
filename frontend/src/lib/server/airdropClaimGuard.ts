import "server-only";

// A given eth address can only have one claim transaction being built at a
// time — this is a single-instance devnet deployment (see dataStore.ts), so
// an in-memory guard is a cheap, adequate match for that same constraint.
// Cleared by /api/airdrop/finalize once the claim actually lands, or after
// CLAIM_IN_FLIGHT_TTL_MS if the claimant never comes back to submit it.
const claimsInFlight = new Map<string, number>();
const CLAIM_IN_FLIGHT_TTL_MS = 5 * 60_000;

export const isClaimInFlight = (key: string): boolean => {
	const startedAt = claimsInFlight.get(key);
	if (startedAt === undefined) return false;
	if (Date.now() - startedAt > CLAIM_IN_FLIGHT_TTL_MS) {
		claimsInFlight.delete(key);
		return false;
	}
	return true;
};

export const markClaimInFlight = (key: string): void => {
	claimsInFlight.set(key, Date.now());
};

export const clearClaimInFlight = (key: string): void => {
	claimsInFlight.delete(key);
};
