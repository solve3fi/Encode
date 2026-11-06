import "server-only";
import type { BN, Idl, Program } from "@coral-xyz/anchor";
import { type PublicKey, PublicKey as PublicKeyValue } from "@solana/web3.js";
import {
	getFaucetAuthority,
	getFaucetConnection,
} from "@/lib/server/faucetSigner";
import { getVesolveServerProgram } from "@/lib/server/vesolveServerProgram";

type RawLock = { owner: PublicKey; amount: BN };
type LockClient = {
	fetchNullable: (address: PublicKey) => Promise<RawLock | null>;
};

/**
 * Whether a stale claim reservation's transaction actually landed.
 *
 * The reserved lock address is only the protocol's *next* lock id at build time, so once that id is taken by
 * anyone else's create_lock the account exists without this claim ever landing (e.g. the claimant had no SOL
 * for fees and the send failed). Existence alone is therefore no proof: the lock must belong to the claimant
 * and hold exactly the allocation. RPC errors propagate so the caller refuses instead of reissuing a claim.
 */
export async function reservedClaimLanded(
	program: Program<Idl>,
	lockAddress: PublicKey,
	recipient: PublicKey,
	amountRaw: bigint,
): Promise<boolean> {
	const locks = (program.account as unknown as Record<string, LockClient>).lock;
	const lock = await locks.fetchNullable(lockAddress);
	if (!lock) return false;
	return (
		lock.owner.equals(recipient) && BigInt(lock.amount.toString()) === amountRaw
	);
}

type ClaimRecord = {
	minted: boolean;
	locked: boolean;
	mintedSignature?: string;
	lockedSignature?: string;
	reservedLockAddress?: string;
	reservedRecipient?: string;
	reservedAt?: number;
	mintedAt?: number;
	lockedAt?: number;
};

/**
 * A claim marked done with no transaction signature but a reservation: only the old stale-reservation path wrote
 * that (before 222b43b it treated "the reserved lock id exists" as proof). Such records must be re-proven on chain.
 */
export const isUnprovenClaim = (record: ClaimRecord) =>
	(record.minted || record.locked) &&
	!record.mintedSignature &&
	!record.lockedSignature &&
	!!record.reservedLockAddress;

/**
 * Returns the record reopened (unclaimed, no reservation) when it is an unproven claim whose reserved lock is not the
 * claimant's lock holding exactly the allocation; otherwise returns it unchanged. RPC errors propagate.
 */
export async function reopenUnprovenClaim<T extends ClaimRecord>(
	record: T,
	recipient: PublicKey,
	amountRaw: bigint,
): Promise<T> {
	if (!isUnprovenClaim(record) || !record.reservedLockAddress) return record;
	const landed = await reservedClaimLanded(
		getVesolveServerProgram(getFaucetConnection(), getFaucetAuthority()),
		new PublicKeyValue(record.reservedLockAddress),
		recipient,
		amountRaw,
	);
	if (landed) return record;
	const {
		reservedLockAddress: _lock,
		reservedRecipient: _recipient,
		reservedAt: _at,
		mintedAt: _minted,
		lockedAt: _locked,
		...rest
	} = record;
	return { ...rest, minted: false, locked: false } as T;
}
