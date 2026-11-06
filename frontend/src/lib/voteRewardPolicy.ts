import { type AccountInfo, PublicKey } from "@solana/web3.js";

export const AUTO_VOTE_FEE_BPS = 1500;
const PARTNER_VOTER_DISCRIMINATOR = [101, 31, 43, 11, 19, 8, 248, 90];

/** Mirrors PartnerVoter::is_exempt for the canonical PDA fetched by the caller. */
export function isPartnerVoterExempt(
	info: AccountInfo<Buffer> | null,
	voter: PublicKey,
	programId: PublicKey,
): boolean {
	if (!info || !info.owner.equals(programId) || info.data.length === 0)
		return false;
	if (
		info.data.length < 49 ||
		!info.data
			.subarray(0, 8)
			.every((value, i) => value === PARTNER_VOTER_DISCRIMINATOR[i])
	)
		throw new Error("Invalid partner voter account");
	return new PublicKey(info.data.subarray(8, 40)).equals(voter);
}

export function voteRewardFeeBps(
	owner: PublicKey,
	recordedVoter: PublicKey,
	partnerExempt: boolean,
): number {
	return owner.equals(recordedVoter) || partnerExempt ? 0 : AUTO_VOTE_FEE_BPS;
}

export function lastClaimableVoteEpoch(currentEpoch: number): number {
	if (!Number.isSafeInteger(currentEpoch) || currentEpoch < 0)
		throw new Error("Invalid protocol epoch");
	return currentEpoch - 1;
}
