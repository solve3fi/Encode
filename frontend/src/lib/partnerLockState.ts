// How a partner's veSOLV3 lock stands for auto-voting, from the on-chain enrollment and voter choice. Kept free of
// imports so a node script can test it. The partner voter only counts when the owner's choice is NEWER than the
// current enrollment: a choice left over from an earlier enrollment is ignored by the program and the keeper alike.

export type LockAutoState =
	/** Not enrolled: the owner votes this lock by hand. */
	| "off"
	/** Enrolled in the public Auto-Vote, so the standard Auto-Vote fee applies. */
	| "public"
	/** Enrolled and the owner chose the shared partner voter: voted for the partner's own gauge, no fee. */
	| "free";

export function lockAutoState(input: {
	enrolled: boolean;
	enrolledAt?: bigint | number | string | null;
	delegateVoter?: string | null;
	delegateSetAt?: bigint | number | string | null;
	partnerVoter?: string | null;
}): LockAutoState {
	if (!input.enrolled) return "off";
	if (
		input.partnerVoter &&
		input.delegateVoter === input.partnerVoter &&
		input.delegateSetAt !== undefined &&
		input.delegateSetAt !== null &&
		input.enrolledAt !== undefined &&
		input.enrolledAt !== null &&
		BigInt(input.delegateSetAt) >= BigInt(input.enrolledAt)
	) {
		return "free";
	}
	return "public";
}

/**
 * The lock new SOLV3 should be added to: the partner's largest lock that is on free auto-vote, else the largest
 * enrolled lock, else the largest lock. Adding to an existing lock keeps its id, its enrollment and its voter choice,
 * so auto-voting continues; a brand-new lock would be a different, unregistered id.
 */
export function preferredLock<
	T extends { amount: bigint; state: LockAutoState },
>(locks: T[]): T | undefined {
	const rank = (lock: T) =>
		lock.state === "free" ? 2 : lock.state === "public" ? 1 : 0;
	return [...locks].sort(
		(a, b) =>
			rank(b) - rank(a) ||
			(b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0),
	)[0];
}

/** Whole-token SOLV3 amount for the Half and Max buttons, rounded DOWN so it never exceeds the balance. */
export function lockFraction(
	balanceRaw: bigint,
	decimals: number,
	fraction: 0.5 | 1,
): { raw: bigint; text: string } {
	const raw = fraction === 1 ? balanceRaw : balanceRaw / BigInt(2);
	const base = BigInt(10) ** BigInt(decimals);
	const whole = raw / base;
	const frac = (raw % base)
		.toString()
		.padStart(decimals, "0")
		.replace(/0+$/, "");
	return { raw, text: frac ? `${whole}.${frac}` : whole.toString() };
}

/** Raw base units from the text typed in the amount box; null when it is empty, invalid or has too many decimals. */
export function parseSolv3Amount(
	text: string,
	decimals: number,
): bigint | null {
	const clean = text.replace(/,/g, "").trim();
	if (!/^\d+(\.\d+)?$/.test(clean)) return null;
	const [whole, frac = ""] = clean.split(".");
	if (frac.length > decimals) return null;
	return (
		BigInt(whole) * BigInt(10) ** BigInt(decimals) +
		BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")
	);
}
