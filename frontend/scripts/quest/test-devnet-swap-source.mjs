import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createProgramTransactionSource,
	decodabilityCheck,
} from "./devnet-swap-source.mjs";

const PublicKey = class {
	constructor(value) {
		this.value = value;
	}
};
const tx = (signature, slot, err = null) => ({
	slot,
	blockTime: 1_700_000_000 + slot,
	meta: { err },
	transaction: { signatures: [signature] },
});
function fixture({ entries, undecodable = [], finalized = 100, pageSize = 1000 }) {
	const calls = { sigPages: 0, txs: [] };
	const byId = new Map(entries.map((e) => [e.signature, e]));
	const connection = {
		getSlot: async () => finalized,
		getSignaturesForAddress: async (_program, options) => {
			calls.sigPages++;
			const newestFirst = [...entries].sort((a, b) => b.slot - a.slot);
			const start = options.before
				? newestFirst.findIndex((e) => e.signature === options.before) + 1
				: 0;
			return newestFirst.slice(start, start + (options.limit ?? 1000));
		},
		getTransaction: async (signature) => {
			calls.txs.push(signature);
			const e = byId.get(signature);
			return e?.missing ? null : tx(signature, e.slot, e.txErr ?? null);
		},
	};
	const source = createProgramTransactionSource({
		connection,
		programId: "program",
		PublicKey,
		paceMs: 0,
		maxRetries: 0,
		pageSize,
		canDecode: async (block) =>
			!undecodable.includes(block.transactions[0].transaction.signatures[0]),
	});
	return { source, calls };
}
const sig = (name, slot, extra = {}) => ({
	signature: name,
	slot,
	err: null,
	...extra,
});

test("the source refuses use before a consistent cut is captured", async () => {
	const { source } = fixture({ entries: [] });
	await assert.rejects(source.finalizedSlot(), /primed/);
	await assert.rejects(source.readRange(0, 1), /primed/);
});

test("only program transactions in the requested range are fetched, ascending by slot", async () => {
	const { source, calls } = fixture({
		entries: [sig("a", 10), sig("b", 20), sig("c", 30), sig("d", 95)],
	});
	await source.prime(10);
	assert.equal(await source.finalizedSlot(), 100);
	const blocks = await source.readRange(15, 40);
	assert.deepEqual(
		blocks.map((b) => b.slot),
		[20, 30],
	);
	assert.deepEqual(calls.txs, ["b", "c"]);
});

test("signatures above the captured finalized slot are never read", async () => {
	const { source } = fixture({
		entries: [sig("a", 50), sig("late", 120)],
		finalized: 100,
	});
	await source.prime(0);
	assert.deepEqual(
		(await source.readRange(0, 100)).map((b) => b.slot),
		[50],
	);
	await assert.rejects(source.readRange(0, 120), /outside/);
});

test("undecodable and failed transactions are skipped and counted, never fatal", async () => {
	const { source } = fixture({
		entries: [
			sig("ok", 10),
			sig("admin", 20),
			sig("failedOnChain", 30, { err: { InstructionError: [0, "x"] } }),
			sig("failedMeta", 40, { txErr: { InstructionError: [0, "y"] } }),
		],
		undecodable: ["admin"],
	});
	await source.prime(0);
	const blocks = await source.readRange(0, 100);
	assert.deepEqual(
		blocks.map((b) => b.transactions[0].transaction.signatures[0]),
		["ok"],
	);
	const stats = source.stats();
	assert.equal(stats.skippedUndecodable, 1);
	assert.equal(stats.failedTransactions, 2);
});

test("a transaction that cannot be fetched fails closed", async () => {
	const { source } = fixture({ entries: [sig("gone", 10, { missing: true })] });
	await source.prime(0);
	await assert.rejects(source.readRange(0, 100), /unavailable/);
});

test("several program transactions in one slot become one ascending block", async () => {
	const { source } = fixture({
		entries: [sig("z", 10), sig("a", 10), sig("m", 11)],
	});
	await source.prime(0);
	const blocks = await source.readRange(0, 100);
	assert.deepEqual(
		blocks.map((b) => b.slot),
		[10, 11],
	);
	assert.deepEqual(
		blocks[0].transactions.map((t) => t.transaction.signatures[0]),
		["a", "z"],
	);
});

test("signature paging reaches back to the floor across pages", async () => {
	const entries = Array.from({ length: 25 }, (_, i) => sig(`s${i}`, i + 1));
	const { source, calls } = fixture({ entries, pageSize: 10 });
	const primed = await source.prime(1);
	assert.equal(primed.signatures, 25);
	assert.ok(calls.sigPages >= 3);
	const stopEarly = fixture({ entries, pageSize: 10 });
	assert.equal((await stopEarly.source.prime(20)).signatures, 6);
});

test("a repeated read reuses fetched transactions", async () => {
	const { source, calls } = fixture({ entries: [sig("a", 10)] });
	await source.prime(0);
	await source.readRange(0, 100);
	await source.readRange(0, 100);
	assert.equal(calls.txs.length, 1);
});

test("the decodability check turns decoder refusals into a plain boolean", async () => {
	const check = decodabilityCheck({
		decode: async (block) => {
			if (block.slot === 2) throw new Error("Unsupported Solve instruction");
			return [];
		},
	});
	assert.equal(await check({ slot: 1 }), true);
	assert.equal(await check({ slot: 2 }), false);
});
