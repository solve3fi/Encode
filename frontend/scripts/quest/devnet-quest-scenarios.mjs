// Invented Passports and aggregate metrics for local Quest Lab previews only.
const BASE = {
	verifiedWalletConnections: 0,
	verifiedDevnetPassMints: 0,
	qualifyingSwaps: 0,
	activeTradingDays: 0,
	featuredPoolsJoined: 0,
	longestFeaturedLpStreakDays: 0,
	qualifiedTraderReferrals: 0,
	qualifiedLpReferrals: 0,
};

function scenario(name, passportId, metrics) {
	return Object.freeze({
		name,
		snapshot: Object.freeze({
			network: "DEVNET",
			fixtureKind: "SYNTHETIC_DEVNET",
			passportId,
			computedThroughSlot: 1000,
			metrics: Object.freeze({ ...BASE, ...metrics }),
		}),
	});
}

export const DEVNET_QUEST_SCENARIOS = Object.freeze([
	scenario("newcomer", "11111111-1111-4111-8111-111111111111", {}),
	scenario("wallet-connected", "77777777-7777-4777-8777-777777777777", {
		verifiedWalletConnections: 1,
	}),
	scenario("pass-minted", "88888888-8888-4888-8888-888888888888", {
		verifiedWalletConnections: 1,
		verifiedDevnetPassMints: 1,
	}),
	scenario("first-trade", "22222222-2222-4222-8222-222222222222", {
		qualifyingSwaps: 1,
		activeTradingDays: 1,
	}),
	scenario("regular-trader", "33333333-3333-4333-8333-333333333333", {
		qualifyingSwaps: 12,
		activeTradingDays: 5,
	}),
	scenario("liquidity-builder", "44444444-4444-4444-8444-444444444444", {
		qualifyingSwaps: 15,
		activeTradingDays: 8,
		featuredPoolsJoined: 1,
		longestFeaturedLpStreakDays: 8,
		qualifiedTraderReferrals: 1,
	}),
	scenario("community-champion", "55555555-5555-4555-8555-555555555555", {
		verifiedWalletConnections: 1,
		verifiedDevnetPassMints: 1,
		qualifyingSwaps: 30,
		activeTradingDays: 14,
		featuredPoolsJoined: 2,
		longestFeaturedLpStreakDays: 31,
		qualifiedTraderReferrals: 3,
		qualifiedLpReferrals: 3,
	}),
	scenario("missing-evidence", "66666666-6666-4666-8666-666666666666", {
		verifiedWalletConnections: null,
		verifiedDevnetPassMints: null,
		featuredPoolsJoined: null,
		longestFeaturedLpStreakDays: null,
		qualifiedTraderReferrals: null,
		qualifiedLpReferrals: null,
	}),
]);
