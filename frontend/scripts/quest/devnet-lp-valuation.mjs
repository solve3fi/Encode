// TEST-ONLY Devnet LP valuation (not an approved oracle). Same spirit as the swap policy: the project's
// own devUSDC mint is exactly one US dollar and a position is worth the devUSDC it currently holds on
// its devUSDC side, counted at deposit and withdrawal time. The other leg is not priced, so a pool
// without devUSDC is worth zero and a position's value never depends on an unverified price.
//
// A snapshot is written for every liquidity increase/decrease event: the position's running value after
// that event. Increases floor to the cent and decreases round up, so error can only understate value.
// Positions are valued as net deposits (cost basis), not marked to market.
export const LP_VALUATION_SOURCE = "devnet-usdc-leg";
export const LP_VALUATION_VERSION = "devnet-usdc-leg-lp-v1";
export const LP_SNAPSHOT_PREFIX = "lp-v1:";

const RAW = /^[0-9]+$/;

/** Pure: the devUSDC-leg amount of one liquidity event, in raw token units. */
export function usdcLegRaw({ payload, mintA, mintB, usdcMint }) {
	if (
		!payload ||
		!RAW.test(String(payload.tokenAAmountRaw)) ||
		!RAW.test(String(payload.tokenBAmountRaw))
	)
		throw new TypeError("Invalid liquidity payload.");
	if (mintA === usdcMint) return { side: "tokenA", raw: BigInt(payload.tokenAAmountRaw) };
	if (mintB === usdcMint) return { side: "tokenB", raw: BigInt(payload.tokenBAmountRaw) };
	return { side: "none", raw: 0n };
}

/**
 * Pure: the position's running value after one event. `kind` is liquidity_increase or
 * liquidity_decrease; `previousCents` is the value after the position's previous event (0 if none).
 */
export function valueLiquidityEvent({
	kind,
	payload,
	mintA,
	mintB,
	usdcMint,
	usdcDecimals,
	previousCents,
}) {
	if (kind !== "liquidity_increase" && kind !== "liquidity_decrease")
		throw new TypeError("Not a liquidity event.");
	if (!Number.isInteger(usdcDecimals) || usdcDecimals < 0 || usdcDecimals > 18)
		throw new RangeError("Invalid devUSDC decimals.");
	if (typeof previousCents !== "bigint" || previousCents < 0n)
		throw new TypeError("Invalid previous value.");
	const { side, raw } = usdcLegRaw({ payload, mintA, mintB, usdcMint });
	const scale = 10n ** BigInt(usdcDecimals);
	const increase = kind === "liquidity_increase";
	// floor for deposits, ceiling for withdrawals
	const cents = increase
		? (raw * 100n) / scale
		: (raw * 100n + scale - 1n) / scale;
	const next = increase ? previousCents + cents : previousCents - cents;
	const clamped = next < 0n;
	return {
		valueUsdCents: clamped ? 0n : next,
		evidence: {
			rule: "1 devUSDC = 1 USD; position value = net devUSDC-side deposits (Devnet test policy, not an oracle)",
			usdcMint,
			usdcDecimals,
			valuedSide: side,
			rawUsdcAmount: raw.toString(),
			eventKind: kind,
			deltaUsdCents: (increase ? cents : -cents).toString(),
			previousUsdCents: previousCents.toString(),
			clampedAtZero: clamped,
			poolMintA: mintA,
			poolMintB: mintB,
		},
	};
}

/**
 * Values every liquidity event without a snapshot, in chain order. Idempotent: a replay that disagrees
 * with a stored snapshot is refused. A position whose earlier event could not be valued waits (its later
 * events are skipped this round) so a running value is never computed from a gap.
 */
export async function runLpValuations({
	pool,
	campaignId,
	resolvePoolMints,
	usdcMint,
	usdcDecimals,
	limit = 500,
}) {
	const client = await pool.connect();
	const result = { valued: 0, unresolved: 0, pending: 0 };
	try {
		const pending = (
			await client.query(
				`SELECT e.id::text AS id, e.event_kind, e.wallet, e.pool_address, e.position_address, e.payload,
				 extract(epoch FROM e.block_time)::bigint::text AS block_seconds
				 FROM genesis.chain_events e
				 LEFT JOIN genesis.lp_value_snapshots s
				   ON s.campaign_id = e.campaign_id AND s.snapshot_key = $2 || e.id::text
				 WHERE e.campaign_id = $1 AND e.event_kind IN ('liquidity_increase','liquidity_decrease')
				   AND s.id IS NULL
				 ORDER BY e.id LIMIT $3`,
				[campaignId, LP_SNAPSHOT_PREFIX, limit],
			)
		).rows;
		result.pending = pending.length;
		const blocked = new Set();
		const state = new Map();
		for (const row of pending) {
			const position = row.position_address;
			if (blocked.has(position)) continue;
			let mints;
			try {
				mints = await resolvePoolMints(row.pool_address);
			} catch {
				result.unresolved++;
				blocked.add(position);
				continue;
			}
			if (!state.has(position)) {
				const last = (
					await client.query(
						`SELECT value_usd_cents::text AS value, sequence::text AS sequence
						 FROM genesis.lp_value_snapshots
						 WHERE campaign_id = $1 AND position_address = $2
						 ORDER BY effective_at DESC, sequence DESC LIMIT 1`,
						[campaignId, position],
					)
				).rows[0];
				state.set(position, {
					cents: last ? BigInt(last.value) : 0n,
					sequence: last ? BigInt(last.sequence) + 1n : 0n,
				});
			}
			const current = state.get(position);
			const { valueUsdCents, evidence } = valueLiquidityEvent({
				kind: row.event_kind,
				payload: row.payload,
				mintA: mints.mintA,
				mintB: mints.mintB,
				usdcMint,
				usdcDecimals,
				previousCents: current.cents,
			});
			const key = `${LP_SNAPSHOT_PREFIX}${row.id}`;
			const inserted = await client.query(
				`INSERT INTO genesis.lp_value_snapshots
				 (campaign_id, snapshot_key, position_address, wallet, pool_address, effective_at, sequence,
				  value_usd_cents, chain_event_id, valuation_source, valuation_version, price_evidence)
				 VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7, $8, $9, $10, $11, $12::jsonb)
				 ON CONFLICT (campaign_id, snapshot_key) DO NOTHING
				 RETURNING id`,
				[
					campaignId,
					key,
					position,
					row.wallet,
					row.pool_address,
					row.block_seconds,
					current.sequence.toString(),
					valueUsdCents.toString(),
					row.id,
					LP_VALUATION_SOURCE,
					LP_VALUATION_VERSION,
					JSON.stringify(evidence),
				],
			);
			if (inserted.rowCount !== 1) {
				const replay = (
					await client.query(
						`SELECT value_usd_cents = $3::numeric AND price_evidence = $4::jsonb AS matches
						 FROM genesis.lp_value_snapshots WHERE campaign_id = $1 AND snapshot_key = $2`,
						[campaignId, key, valueUsdCents.toString(), JSON.stringify(evidence)],
					)
				).rows[0];
				if (replay?.matches !== true)
					throw new Error("Conflicting LP valuation replay.");
			}
			state.set(position, {
				cents: valueUsdCents,
				sequence: current.sequence + 1n,
			});
			result.valued++;
		}
		return result;
	} finally {
		client.release();
	}
}
