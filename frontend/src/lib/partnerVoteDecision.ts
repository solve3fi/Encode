// What the public Auto-Vote keeper (scripts/public-auto-vote-keeper.mjs + scripts/lib/partner-vote-targets.mjs)
// will do with one partner lock. Kept free of imports so a node script can test it. The rules mirror the
// keeper exactly: a lock is steered to a partner pool only when ALL of these hold, otherwise it is voted
// by the default shared ranking (or left alone).
//
//   1. the lock's OWNER wallet is listed on an ACTIVE partner space that records a pool,
//   2. that wallet saved "auto-vote for our gauge" ON with a signed choice,
//   3. the lock is enrolled in the public Auto-Vote (the owner signed enroll_auto_vote for that lock),
//   4. the lock has voting power,
//   5. the partner's gauge is ACTIVE (status 2). Until then the keeper leaves the lock alone.
//
// The veSOLV3 id is never looked up by partner: ownership decides. Any enrolled lock held by a listed wallet is
// the partner's; a lock held by an unlisted wallet is not, even if the same person owns it.

export type SpaceLike = {
	slug: string;
	status: string;
	poolAddress?: string | null;
	wallets: string[];
};

export type WalletPreference = { saved: boolean; vote: boolean };

export type LockVerdict =
	| { kind: "partner-gauge"; pool: string }
	| { kind: "skipped"; reason: string };

/** Pool a wallet is steered to, or why not. Mirrors partnerVoteTargets(). */
export function walletTarget(
	spaces: SpaceLike[],
	wallet: string,
	preference: WalletPreference,
): { pool: string } | { reason: string } {
	let pool: string | null = null;
	let conflict = false;
	let sawSpace = false;
	let sawPool = false;
	for (const space of spaces) {
		if (!space.wallets.includes(wallet)) continue;
		sawSpace = true;
		if (space.status !== "active") continue;
		if (!space.poolAddress) continue;
		sawPool = true;
		if (pool !== null && pool !== space.poolAddress) conflict = true;
		else pool = space.poolAddress;
	}
	if (!sawSpace) return { reason: "Wallet is not listed on any partner space" };
	if (!sawPool) {
		return {
			reason: "No active partner space with a recorded pool for this wallet",
		};
	}
	if (conflict) {
		return {
			reason:
				"Wallet is on two active partner spaces with different pools, so the keeper skips it",
		};
	}
	if (!preference.saved || !preference.vote) {
		return {
			reason: "Auto-vote for our gauge is off (no signed choice saved)",
		};
	}
	return { pool: pool as string };
}

export function lockVerdict(input: {
	target: { pool: string } | { reason: string };
	enrolled: boolean;
	votingPower: number;
	gaugeStatus: number | null;
	gaugeLabel: string;
}): LockVerdict {
	if ("reason" in input.target) {
		return { kind: "skipped", reason: input.target.reason };
	}
	if (!input.enrolled) {
		return {
			kind: "skipped",
			reason:
				"Lock is not enrolled in Auto-Vote (the owner has not enrolled it)",
		};
	}
	if (!(input.votingPower > 0)) {
		return { kind: "skipped", reason: "No voting power" };
	}
	if (input.gaugeStatus !== 2) {
		return {
			kind: "skipped",
			reason:
				input.gaugeStatus === null
					? "The partner pool has no gauge yet: the keeper leaves this lock alone until it has an active one. Set the partner pool to the pool that has the active gauge."
					: `The partner gauge is ${input.gaugeLabel.toLowerCase()}: the keeper leaves this lock alone until it is active`,
		};
	}
	return { kind: "partner-gauge", pool: input.target.pool };
}
