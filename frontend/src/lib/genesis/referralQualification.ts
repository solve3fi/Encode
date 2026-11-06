/** Pure referral qualification over attributed wallets and reviewed activity. */

export type ReferralBinding = {
	campaignId: string;
	refereeWallet: string;
	referrerWallet: string;
	attributedAtSeconds: number;
	status: "pending" | "qualified" | "rejected";
};

export type ReviewedRefereeActivity = {
	campaignId: string;
	wallet: string;
	/** Metrics cover only activity at or after this time in the campaign. */
	windowStartsAtSeconds: number;
	reviewStatus: "pending" | "approved" | "flagged" | "disqualified";
	qualifyingSwaps: number;
	activeTradingDays: number;
	qualifyingLpSeconds: bigint;
};

export type ReferralQualificationRules = {
	campaignId: string;
	minimumTraderSwaps: number;
	minimumTraderActiveDays: number;
	minimumLpSeconds: bigint;
};

function timestamp(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new RangeError(`${label} must be a non-negative Unix second.`);
}

function cycleFrom(referee: string, parents: Map<string, string>): boolean {
	const seen = new Set<string>();
	let wallet: string | undefined = referee;
	while (wallet) {
		if (seen.has(wallet)) return true;
		seen.add(wallet);
		wallet = parents.get(wallet);
	}
	return false;
}

/**
 * A click or wallet connection never counts. The caller supplies complete
 * post-attribution activity and independent campaign review for each referee.
 * Risk flags require manual review; this function does not reject a wallet.
 */
export function summarizeQualifiedReferrals(input: {
	campaignId: string;
	referrerWallet: string;
	bindings: readonly ReferralBinding[];
	activity: readonly ReviewedRefereeActivity[];
	rules: ReferralQualificationRules;
}) {
	const { campaignId, referrerWallet, bindings, activity, rules } = input;
	if (
		!campaignId ||
		!referrerWallet ||
		rules.campaignId !== campaignId ||
		!Number.isSafeInteger(rules.minimumTraderSwaps) ||
		rules.minimumTraderSwaps <= 0 ||
		!Number.isSafeInteger(rules.minimumTraderActiveDays) ||
		rules.minimumTraderActiveDays <= 0 ||
		typeof rules.minimumLpSeconds !== "bigint" ||
		rules.minimumLpSeconds <= BigInt(0)
	)
		throw new Error("Invalid Genesis referral qualification rules.");
	const parents = new Map<string, string>();
	for (const binding of bindings) {
		if (
			binding.campaignId !== campaignId ||
			!binding.refereeWallet ||
			!binding.referrerWallet ||
			!["pending", "qualified", "rejected"].includes(binding.status)
		)
			throw new Error("Invalid Genesis referral binding.");
		timestamp(binding.attributedAtSeconds, "Referral attribution");
		if (parents.has(binding.refereeWallet))
			throw new Error("Repeated referee attribution in one campaign.");
		parents.set(binding.refereeWallet, binding.referrerWallet);
	}
	const reviewed = new Map<string, ReviewedRefereeActivity>();
	for (const item of activity) {
		if (
			item.campaignId !== campaignId ||
			!item.wallet ||
			reviewed.has(item.wallet) ||
			!["pending", "approved", "flagged", "disqualified"].includes(
				item.reviewStatus,
			) ||
			!Number.isSafeInteger(item.qualifyingSwaps) ||
			item.qualifyingSwaps < 0 ||
			!Number.isSafeInteger(item.activeTradingDays) ||
			item.activeTradingDays < 0 ||
			item.activeTradingDays > item.qualifyingSwaps ||
			typeof item.qualifyingLpSeconds !== "bigint" ||
			item.qualifyingLpSeconds < BigInt(0)
		)
			throw new Error("Invalid or repeated reviewed referee activity.");
		timestamp(item.windowStartsAtSeconds, "Referee activity window");
		reviewed.set(item.wallet, item);
	}
	let qualifiedTraderReferrals = 0;
	let qualifiedLpReferrals = 0;
	const riskFlags: {
		refereeWallet: string;
		reason: "self_referral" | "circular_referral";
	}[] = [];
	for (const binding of bindings) {
		if (binding.referrerWallet !== referrerWallet) continue;
		if (
			binding.refereeWallet === referrerWallet ||
			cycleFrom(binding.refereeWallet, parents)
		) {
			riskFlags.push({
				refereeWallet: binding.refereeWallet,
				reason:
					binding.refereeWallet === referrerWallet
						? "self_referral"
						: "circular_referral",
			});
			continue;
		}
		if (binding.status !== "qualified") continue;
		const metrics = reviewed.get(binding.refereeWallet);
		if (!metrics)
			throw new Error("Referee review and activity are unavailable.");
		if (metrics.windowStartsAtSeconds < binding.attributedAtSeconds)
			throw new Error("Referee activity predates attribution.");
		if (metrics.reviewStatus !== "approved") continue;
		if (
			metrics.qualifyingSwaps >= rules.minimumTraderSwaps &&
			metrics.activeTradingDays >= rules.minimumTraderActiveDays
		)
			qualifiedTraderReferrals++;
		if (metrics.qualifyingLpSeconds >= rules.minimumLpSeconds)
			qualifiedLpReferrals++;
	}
	return { qualifiedTraderReferrals, qualifiedLpReferrals, riskFlags };
}
