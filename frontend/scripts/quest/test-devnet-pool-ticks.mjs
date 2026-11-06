import assert from "node:assert/strict";
import test from "node:test";
import {
	HEARTBEAT_SECONDS,
	POOL_DISCRIMINATOR,
	decodePoolTick,
	runPoolTickSamples,
} from "./devnet-pool-ticks.mjs";

const PROGRAM = "11111111111111111111111111111112";
const POOL_A = "7vRYZ3PqRZt9AoDksSVo4bEKY7CU61Ees5PXMvnZdYpk";
const POOL_B = "7bNGJpmcMLG1qSVv1RRSbR5HX6RBAFwVhPH2ScndH176";

class Key {
	constructor(value) {
		this.value = value;
	}
	equals(other) {
		return this.value === other.value;
	}
}

function poolData(tick, discriminator = POOL_DISCRIMINATOR) {
	const data = Buffer.alloc(200);
	Buffer.from(discriminator).copy(data, 0);
	data.writeInt32LE(tick, 81);
	return data;
}

function fixture({ accounts, stored = [] }) {
	const rows = [...stored];
	const client = {
		async query(sql, params) {
			if (sql.includes("INSERT INTO quest.pool_tick_samples")) {
				const [pool, slot, at, tick] = params;
				if (rows.some((r) => r.pool === pool && r.slot === slot)) return { rowCount: 0 };
				rows.push({ pool, slot, observedMs: Date.parse(at), tick });
				return { rowCount: 1 };
			}
			const last = rows.filter((r) => r.pool === params[0]).at(-1);
			return {
				rows: last ? [{ tick_current_index: last.tick, observed_ms: String(last.observedMs) }] : [],
			};
		},
	};
	const connection = {
		async getAccountInfoAndContext(key) {
			const entry = accounts[key.value];
			if (entry instanceof Error) throw entry;
			return { context: { slot: entry?.slot ?? 1 }, value: entry?.account ?? null };
		},
	};
	return { client, connection, rows };
}

const run = (f, pools, now) =>
	runPoolTickSamples({
		client: f.client,
		connection: f.connection,
		programId: PROGRAM,
		PublicKey: Key,
		pools,
		now: () => now,
	});

const owned = (tick, slot = 1) => ({
	slot,
	account: { owner: new Key(PROGRAM), data: poolData(tick) },
});

test("decodePoolTick reads the signed tick and refuses anything that is not a pool", () => {
	assert.equal(decodePoolTick(poolData(-12345)), -12345);
	assert.equal(decodePoolTick(poolData(443636)), 443636);
	assert.throws(() => decodePoolTick(poolData(1, Buffer.alloc(8))), /Not a Solve pool/);
	assert.throws(() => decodePoolTick(Buffer.alloc(20)), /Not a Solve pool/);
	assert.throws(() => decodePoolTick(null), /Not a Solve pool/);
	assert.throws(() => decodePoolTick(poolData(443637)), /out of range/);
});

test("first sample is recorded, an unchanged tick is skipped, then a heartbeat is stored", async () => {
	const f = fixture({ accounts: { [POOL_A]: owned(10, 1) } });
	let out = await run(f, [POOL_A], 1_000_000);
	assert.deepEqual([out.recorded, out.unchanged, out.failed], [1, 0, 0]);
	f.rows.length = 1;
	out = await run(f, [POOL_A], 1_000_000 + 60_000);
	assert.deepEqual([out.recorded, out.unchanged], [0, 1]);
	const later = 1_000_000 + HEARTBEAT_SECONDS * 1000 + 1;
	const f2 = fixture({ accounts: { [POOL_A]: owned(10, 2) }, stored: f.rows });
	out = await run(f2, [POOL_A], later);
	assert.equal(out.recorded, 1, "an unchanged tick is still stored once the heartbeat is due");
});

test("a changed tick is stored immediately", async () => {
	const f = fixture({ accounts: { [POOL_A]: owned(11, 5) } });
	f.rows.push({ pool: POOL_A, slot: 1, observedMs: 1_000_000, tick: 10 });
	const out = await run(f, [POOL_A], 1_000_000 + 1000);
	assert.equal(out.recorded, 1);
	assert.equal(f.rows.at(-1).tick, 11);
});

test("one unreadable pool never stops the others", async () => {
	const f = fixture({
		accounts: {
			[POOL_A]: new Error("rpc down"),
			[POOL_B]: owned(-4, 9),
		},
	});
	const logs = [];
	const out = await runPoolTickSamples({
		client: f.client,
		connection: f.connection,
		programId: PROGRAM,
		PublicKey: Key,
		pools: [POOL_A, POOL_B],
		now: () => 5_000_000,
		log: (entry) => logs.push(entry),
	});
	assert.deepEqual([out.recorded, out.failed], [1, 1]);
	assert.equal(f.rows[0].pool, POOL_B);
	assert.ok(logs.some((entry) => entry.action === "pool_tick_sample_failed"));
});

test("an account owned by another program or missing is refused", async () => {
	const f = fixture({
		accounts: {
			[POOL_A]: { slot: 1, account: { owner: new Key("someoneElse"), data: poolData(1) } },
			[POOL_B]: { slot: 1, account: null },
		},
	});
	const out = await run(f, [POOL_A, POOL_B], 1_000);
	assert.deepEqual([out.recorded, out.failed], [0, 2]);
	assert.equal(f.rows.length, 0);
});
