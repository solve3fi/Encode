// Which wallets want their auto-voted locks pointed at their own partner gauge, and at which pool.
// A wallet is targeted only when ALL of these hold: it is listed on an ACTIVE partner space that
// records a pool, and it explicitly saved "auto-vote for our gauge" ON with a signature. Missing or
// unsaved preferences never count, so a wallet that merely enrolled in public Auto-Vote keeps the
// default ranking. A wallet on two active spaces with different pools is ambiguous and is skipped.
export function partnerVoteTargets({ spaces, defaults }) {
	const targets = new Map();
	const conflicts = new Set();
	for (const space of Object.values(spaces ?? {})) {
		if (space?.status !== "active" || typeof space.poolAddress !== "string" || !space.poolAddress)
			continue;
		for (const wallet of space.wallets ?? []) {
			if (defaults?.[wallet]?.vote !== true) continue;
			const existing = targets.get(wallet);
			if (existing !== undefined && existing !== space.poolAddress) conflicts.add(wallet);
			else targets.set(wallet, space.poolAddress);
		}
	}
	for (const wallet of conflicts) targets.delete(wallet);
	return { targets, conflicts: [...conflicts] };
}
