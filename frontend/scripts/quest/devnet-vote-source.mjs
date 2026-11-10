// Devnet vote source for Voting XP (test policy). The ve program emits no vote event, so votes are
// read from chain state instead: each vote leaves a `UserVote` account keyed by (lock, epoch) whose
// `user` is the lock OWNER, even when the public Auto-Vote keeper cast the vote. This module decodes
// those accounts and the ve `Protocol` account, and records them as append-only observations
// (migration 020). It awards nothing: the settler turns ended epochs into Levels.
//
// Layouts (Anchor/Borsh, 8-byte discriminator first), from programs/vesolve/src/states:
//   Protocol : admin 32, token_mint 32, next_nft_token_id u64, total_supply u64, total_locked u64,
//              current_epoch u64 @96, last_emission_time i64, epoch_start_time i64 @112, ...
//   UserVote : user 32 @8, epoch u64 @40, total_voting_power u64 @48, votes: u32 len @56 then
//              len x (gauge 32 + weight u64), then last_vote_time i64, bump u8.
import { createHash } from "node:crypto";
import bs58 from "bs58";

const sha = (value) => createHash("sha256").update(value).digest();
export const USER_VOTE_DISCRIMINATOR = sha("account:UserVote").subarray(0, 8);
export const PROTOCOL_DISCRIMINATOR = sha("account:Protocol").subarray(0, 8);
export const MAX_GAUGE_VOTES = 50;
const PROTOCOL_SEED = Buffer.from("protocol");

const safeNumber = (value, label) => {
	if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n)
		throw new Error(`${label} is out of range.`);
	return Number(value);
};

/** The ve protocol's current epoch and when it started, from the Protocol account data. */
export function decodeProtocolHead(data) {
	if (data.length < 128 || !data.subarray(0, 8).equals(PROTOCOL_DISCRIMINATOR))
		throw new Error("Not a ve Protocol account.");
	const epochStartSeconds = data.readBigInt64LE(112);
	const epochStartTime = new Date(Number(epochStartSeconds) * 1000);
	if (Number.isNaN(epochStartTime.getTime()))
		throw new Error("Protocol epoch start is invalid.");
	return {
		epochId: safeNumber(data.readBigUInt64LE(96), "Protocol epoch"),
		epochStartTime,
	};
}

/** One vote: the lock owner, the epoch, the power at vote time and when it was last cast. */
export function decodeUserVote(data) {
	if (data.length < 68 || !data.subarray(0, 8).equals(USER_VOTE_DISCRIMINATOR))
		throw new Error("Not a UserVote account.");
	const gaugeCount = data.readUInt32LE(56);
	if (gaugeCount < 1 || gaugeCount > MAX_GAUGE_VOTES)
		throw new Error("UserVote gauge count is out of range.");
	const timeOffset = 60 + 40 * gaugeCount;
	if (data.length < timeOffset + 8) throw new Error("UserVote account is truncated.");
	const voteTime = new Date(Number(data.readBigInt64LE(timeOffset)) * 1000);
	if (Number.isNaN(voteTime.getTime())) throw new Error("UserVote time is invalid.");
	const allocations = [];
	for (let i = 0; i < gaugeCount; i++) {
		const at = 60 + 40 * i;
		const weight = data.readBigUInt64LE(at + 32);
		if (weight > 0n) allocations.push({ gauge: bs58.encode(data.subarray(at, at + 32)), weight: weight.toString() });
	}
	const votingPower = data.readBigUInt64LE(48);
	if (votingPower === 0n) throw new Error("UserVote has no voting power.");
	return {
		ownerWallet: bs58.encode(data.subarray(8, 40)),
		epochId: safeNumber(data.readBigUInt64LE(40), "UserVote epoch"),
		votingPower: votingPower.toString(),
		gaugeCount,
		allocations,
		voteTime,
	};
}

function epochFilterBytes(epochId) {
	const bytes = Buffer.alloc(8);
	bytes.writeBigUInt64LE(BigInt(epochId));
	return bs58.encode(bytes);
}

/** Every UserVote of one epoch at finalized commitment, with the slot the read is valid for. */
export async function fetchEpochVotes({ connection, programKey, epochId }) {
	const result = await connection.getProgramAccounts(programKey, {
		commitment: "finalized",
		withContext: true,
		filters: [
			{ memcmp: { offset: 0, bytes: bs58.encode(USER_VOTE_DISCRIMINATOR) } },
			{ memcmp: { offset: 40, bytes: epochFilterBytes(epochId) } },
		],
	});
	const votes = [];
	let skipped = 0;
	for (const { pubkey, account } of result.value) {
		try {
			const vote = decodeUserVote(account.data);
			if (vote.epochId !== epochId) {
				skipped++;
				continue;
			}
			votes.push({ voteAccount: pubkey.toBase58(), ...vote });
		} catch {
			skipped++;
		}
	}
	return { slot: result.context.slot, votes, skipped };
}

const INSERT_VOTE = `INSERT INTO quest.vote_observations
 (epoch_id, vote_account, owner_wallet, voting_power, gauge_count, vote_time, observed_slot)
 VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`;
const DELETE_ALLOCATIONS = `DELETE FROM quest.vote_allocations WHERE epoch_id = $1 AND vote_account = $2`;
const INSERT_ALLOCATION = `INSERT INTO quest.vote_allocations (epoch_id, vote_account, gauge, weight)
 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`;
const INSERT_HEAD = `INSERT INTO quest.vote_epoch_heads (epoch_id, epoch_start_time, observed_slot)
 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`;

/**
 * One observation round. Rescans the last `epochsBack` epochs plus the current one (so the final
 * votes of an epoch are captured after it rolls over), keeps the first observation of each vote,
 * and records the current epoch last, so an epoch is never settled before its votes were read.
 */
export async function runVoteObservations({
	client,
	connection,
	programId,
	PublicKey,
	epochsBack = 1,
	log,
}) {
	const programKey = new PublicKey(programId);
	const [protocolAddress] = PublicKey.findProgramAddressSync([PROTOCOL_SEED], programKey);
	const protocol = await connection.getAccountInfo(protocolAddress, "finalized");
	if (!protocol || !protocol.owner.equals(programKey))
		throw new Error("The ve Protocol account is unavailable.");
	const head = decodeProtocolHead(protocol.data);
	const totals = { epochs: 0, seen: 0, recorded: 0, skipped: 0 };
	let slot = 0;
	for (let epochId = Math.max(0, head.epochId - epochsBack); epochId <= head.epochId; epochId++) {
		const read = await fetchEpochVotes({ connection, programKey, epochId });
		slot = Math.max(slot, read.slot);
		totals.epochs++;
		totals.skipped += read.skipped;
		for (const vote of read.votes) {
			totals.seen++;
			const inserted = await client.query(INSERT_VOTE, [
				vote.epochId,
				vote.voteAccount,
				vote.ownerWallet,
				vote.votingPower,
				vote.gaugeCount,
				vote.voteTime.toISOString(),
				read.slot,
			]);
			totals.recorded += inserted.rowCount ?? 0;
			// The latest allocation of this vote (a re-vote changes it). Never blocks the XP observation above.
			try {
				await client.query(DELETE_ALLOCATIONS, [vote.epochId, vote.voteAccount]);
				for (const a of vote.allocations ?? [])
					await client.query(INSERT_ALLOCATION, [vote.epochId, vote.voteAccount, a.gauge, a.weight]);
			} catch (error) {
				log?.({ action: "vote_allocation_failed", message: String(error?.message ?? error).slice(0, 120) });
			}
		}
	}
	await client.query(INSERT_HEAD, [head.epochId, head.epochStartTime.toISOString(), slot]);
	const summary = { action: "vote_observation_round", currentEpoch: head.epochId, slot, ...totals };
	log?.(summary);
	return summary;
}
