import "server-only";
import { createRpcFetch, PUBLIC_DEVNET_RPC } from "./mainnetRpcFetch";
import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY, type AccountInfo } from "@solana/web3.js";
import idl from "@/configs/vesolve.json";
import type BN from "bn.js";

const PROGRAM = new PublicKey(idl.address);
const coder = new BorshAccountsCoder(idl as unknown as Idl);
const derive = (name: string, ...seeds: Buffer[]) => PublicKey.findProgramAddressSync([Buffer.from(name), ...seeds], PROGRAM)[0];
const u64 = (value: bigint) => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes; };
export class AcceleratorLockError extends Error {}

export function parseAcceleratorLockId(value: unknown): bigint {
	if (typeof value !== "string" || value.length > 16 || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
		throw new AcceleratorLockError("Choose a valid lock ID.");
	return BigInt(value);
}

type RawLock = { owner: PublicKey; ve_token_id: BN; unlock_time: BN; voting_power: BN };
type RawProtocol = { current_epoch: BN; epoch_start_time: BN; epoch_reset_time: BN };
type RawStanding = { lock: PublicKey; votes: unknown[] };
type RawVote = { votes: unknown[] };
function decode<T>(name: string, info: AccountInfo<Buffer> | null): T {
	if (!info || !info.owner.equals(PROGRAM)) throw new AcceleratorLockError("Lock configuration could not be verified.");
	try { return coder.decode(name, info.data) as T; }
	catch { throw new AcceleratorLockError("Lock configuration could not be verified."); }
}

/** Read-only finalized checks; the keeper repeats ownership/standing checks before voting. */
export async function validateAcceleratorLockSelection({
	veTokenId, wallet, previousLockId, activationEpoch = 0,
	connection = new Connection(process.env.SOLVE3_DEVNET_RPC_URL || PUBLIC_DEVNET_RPC, {
		commitment: "finalized", disableRetryOnRateLimit: true,
		fetch: createRpcFetch(process.env.SOLVE3_DEVNET_RPC_URL || PUBLIC_DEVNET_RPC, "devnet"),
	}),
}: { veTokenId: string; wallet: string; previousLockId?: string; activationEpoch?: number; connection?: Connection }) {
	const id = parseAcceleratorLockId(veTokenId);
	const owner = new PublicKey(wallet);
	if (await connection.getGenesisHash() !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
		throw new AcceleratorLockError("Accelerator lock selection requires Devnet.");
	const protocolAddress = derive("protocol");
	const first = decode<RawProtocol>("Protocol", await connection.getAccountInfo(protocolAddress, "finalized"));
	const currentEpoch = BigInt(first.current_epoch.toString());
	const lockAddress = derive("ve_lock", u64(id));
	const oldLock = previousLockId && previousLockId !== veTokenId ? derive("ve_lock", u64(parseAcceleratorLockId(previousLockId))) : null;
	const addresses = [lockAddress, derive("allocation", lockAddress.toBuffer()), protocolAddress, SYSVAR_CLOCK_PUBKEY];
	if (oldLock) addresses.push(derive("user_vote", oldLock.toBuffer(), u64(currentEpoch)));
	const [lockInfo, standingInfo, protocolInfo, clockInfo, previousVoteInfo] = await connection.getMultipleAccountsInfo(addresses, "finalized");
	const lock = decode<RawLock>("Lock", lockInfo), protocol = decode<RawProtocol>("Protocol", protocolInfo);
	if (BigInt(protocol.current_epoch.toString()) !== currentEpoch)
		throw new AcceleratorLockError("The epoch changed. Try saving again.");
	if (!clockInfo || !clockInfo.owner.equals(new PublicKey("Sysvar1111111111111111111111111111111111111")) || clockInfo.data.length < 40) throw new AcceleratorLockError("Chain time is unavailable. Try again.");
	const now = clockInfo.data.readBigInt64LE(32);
	const start = Number.isSafeInteger(activationEpoch) && BigInt(activationEpoch) > currentEpoch
		? BigInt(protocol.epoch_start_time.toString()) + BigInt(protocol.epoch_reset_time.toString()) * (BigInt(activationEpoch) - currentEpoch)
		: now;
	if (!lock.owner.equals(owner) || BigInt(lock.ve_token_id.toString()) !== id)
		throw new AcceleratorLockError("This lock is not held by the Accelerator wallet.");
	if (BigInt(lock.voting_power.toString()) <= BigInt(0) || BigInt(lock.unlock_time.toString()) <= (start > now ? start : now))
		throw new AcceleratorLockError("Choose a lock with voting power that remains locked when Accelerator starts.");
	if (standingInfo) {
		const standing = decode<RawStanding>("AllocationVoter", standingInfo);
		if (!standing.lock.equals(lockAddress) || standing.votes.length > 0)
			throw new AcceleratorLockError("This lock has a standing allocation. Clear its split under Auto-vote wallets before selecting it for Accelerator.");
	}
	if (oldLock && currentEpoch >= BigInt(activationEpoch) && previousVoteInfo) {
		const previousVote = decode<RawVote>("UserVote", previousVoteInfo);
		if (previousVote.votes.length > 0)
			throw new AcceleratorLockError("The current Accelerator lock already voted this epoch. Change the lock before voting starts in the next epoch.");
	}
}
