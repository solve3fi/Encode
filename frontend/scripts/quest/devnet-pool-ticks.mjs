// Devnet pool price samples for range-aware LP quests (test policy). A position earns only while the pool's
// current tick is inside its range, so the worker records each featured pool's `tick_current_index` from the
// finalized pool account. A sample is stored when the tick changes and as a heartbeat otherwise; the
// qualification treats a stretch with no sample for longer than the policy's maximum gap as unobserved and
// credits none of it, so a stopped worker can only cost time, never grant it.
//
// Pool account layout (programs/solve/src/state/solve.rs, verified against the live Devnet pools):
//   8-byte discriminator, solves_config 32, bump 1, tick_spacing u16 @41, fee_rate u16, protocol_fee_rate u16,
//   liquidity u128 @49, sqrt_price u128 @65, tick_current_index i32 @81, ..., token_mint_a @101.
import { createHash } from "node:crypto";

export const POOL_DISCRIMINATOR = createHash("sha256").update("account:Solve").digest().subarray(0, 8);
const TICK_OFFSET = 81;
const MIN_TICK = -443636;
const MAX_TICK = 443636;
/** Store a sample at least this often while the tick does not move (below the qualification's maximum gap). */
export const HEARTBEAT_SECONDS = 240;

/** The pool's current tick from its account data. */
export function decodePoolTick(data) {
	if (!data || data.length < TICK_OFFSET + 4 || !Buffer.from(data.subarray(0, 8)).equals(POOL_DISCRIMINATOR))
		throw new Error("Not a Solve pool account.");
	const tick = Buffer.from(data).readInt32LE(TICK_OFFSET);
	if (tick < MIN_TICK || tick > MAX_TICK) throw new Error("Pool tick is out of range.");
	return tick;
}

const INSERT = `INSERT INTO quest.pool_tick_samples (pool_address, observed_slot, observed_at, tick_current_index)
 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`;
const LAST = `SELECT tick_current_index, (EXTRACT(EPOCH FROM observed_at) * 1000)::bigint::text AS observed_ms
 FROM quest.pool_tick_samples WHERE network = 'DEVNET' AND pool_address = $1
 ORDER BY observed_at DESC, observed_slot DESC LIMIT 1`;

/**
 * One sampling round over the featured pools. Each pool is isolated: one unreadable pool never stops the
 * others. `now` is injectable for tests.
 */
export async function runPoolTickSamples({
	client,
	connection,
	programId,
	PublicKey,
	pools,
	now = () => Date.now(),
	log,
}) {
	const programKey = new PublicKey(programId);
	const totals = { pools: pools.length, recorded: 0, unchanged: 0, failed: 0 };
	for (const address of pools) {
		try {
			const read = await connection.getAccountInfoAndContext(new PublicKey(address), "finalized");
			const account = read.value;
			if (!account || !account.owner.equals(programKey)) throw new Error("Pool account is unavailable.");
			const tick = decodePoolTick(account.data);
			const at = now();
			const last = (await client.query(LAST, [address])).rows[0];
			const unchanged =
				last && Number(last.tick_current_index) === tick && at - Number(last.observed_ms) < HEARTBEAT_SECONDS * 1000;
			if (unchanged) {
				totals.unchanged++;
				continue;
			}
			const inserted = await client.query(INSERT, [address, read.context.slot, new Date(at).toISOString(), tick]);
			totals.recorded += inserted.rowCount ?? 0;
		} catch (error) {
			totals.failed++;
			log?.({
				action: "pool_tick_sample_failed",
				pool: address.slice(0, 6),
				error: error instanceof Error ? error.message.slice(0, 120) : "unknown",
			});
		}
	}
	const summary = { action: "pool_tick_round", ...totals };
	log?.(summary);
	return summary;
}
