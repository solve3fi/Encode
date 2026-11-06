import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { liquidityRangeFixture } from "../../tests/fixtures/quest-position-liquidity.mjs";
import {
	closureEvidenceFixture,
	transferEvidenceFixture,
} from "../../tests/fixtures/quest-position-ownership.mjs";
import { replayPositionLiquidityBlockRange } from "./position-liquidity-replay.mjs";

test("exact anchored addition uses full-block ordinal and retains test-only boundary", async () => {
	const f = liquidityRangeFixture(),
		r = await replayPositionLiquidityBlockRange(f);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "107");
	assert.equal(r.positions[0].transitions[0].beforeLiquidityRaw, "100");
	assert.equal(r.liquidityObservations[0].transactionIndex, 0);
	assert.equal(r.awardEligible, false);
	assert.equal(r.programId, f.anchor.programId);
	assert.equal(r.decoderVersion, "position-liquidity-replay-v1");
	assert.equal(r.solveDecoderVersion, "solve-direct-2");
	assert.equal(r.coverage, "PROVIDED_FINALIZED_BLOCK_RANGE");
	assert.equal(r.positions[0].durationSeconds, undefined);
	assert.match(r.replaySha256, /^[a-f0-9]{64}$/);
	assert.equal(f.blocks[0].block.transactions[0].transactionIndex, 999);
});
test("exact subtraction and zero liquidity preserve open NFT ownership", async () => {
	const r = await replayPositionLiquidityBlockRange(
		liquidityRangeFixture({ kind: "decrease_liquidity", delta: "100" }),
	);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "0");
	assert.equal(r.positions[0].closed, false);
	assert(r.positions[0].ownerWallet);
});
test("u128 arithmetic exceeds Number precision without rounding", async () => {
	const amount = (1n << 64n) + 3n;
	const r = await replayPositionLiquidityBlockRange(
		liquidityRangeFixture({
			baselineLiquidityRaw: amount.toString(),
			delta: amount.toString(),
		}),
	);
	assert.equal(r.positions[0].endSlotLiquidityRaw, (amount * 2n).toString());
});
test("failed attempts preserve the successful transaction's actual block index", async () => {
	const f = liquidityRangeFixture(),
		tx = liquidityRangeFixture({ signature: "failed" }).blocks[0].block
			.transactions[0];
	tx.meta.err = { InstructionError: [0, "Custom"] };
	f.blocks[0].block.transactions.unshift(tx);
	const r = await replayPositionLiquidityBlockRange(f);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "107");
	assert.equal(r.liquidityObservations[0].transactionIndex, 1);
});
test("withdrawal followed by closure yields terminal zero state", async () => {
	const f = liquidityRangeFixture({ kind: "decrease_liquidity", delta: "100" });
	f.blocks[0].block.transactions.push(closureEvidenceFixture().transactions[0]);
	const r = await replayPositionLiquidityBlockRange(f);
	assert.equal(r.positions[0].closed, true);
	assert.equal(r.positions[0].ownerWallet, null);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "0");
});
test("closure without complete withdrawal refuses", async () => {
	const f = liquidityRangeFixture();
	f.blocks[0].block.transactions = [closureEvidenceFixture().transactions[0]];
	await assert.rejects(replayPositionLiquidityBlockRange(f), /zero liquidity/);
});
test("standalone closure cannot hide a deeper Solve invocation", async () => {
	const f = liquidityRangeFixture({ baselineLiquidityRaw: "0" });
	const close = closureEvidenceFixture().transactions[0];
	close.meta.logMessages = [`Program ${f.anchor.programId} invoke [2]`];
	f.blocks[0].block.transactions = [close];
	await assert.rejects(replayPositionLiquidityBlockRange(f), /Solve CPI/);
});
test("transfer does not change liquidity and next LP change belongs to new owner", async () => {
	const f = liquidityRangeFixture({
		ownerWallet: "11111111111111111111111111111113",
		tokenAccountAddress: "11111111111111111111111111111114",
	});
	f.blocks[0].block.transactions.unshift(
		transferEvidenceFixture().transactions[0],
	);
	const r = await replayPositionLiquidityBlockRange(f);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "107");
	assert.equal(
		r.positions[0].transitions[0].beforeLiquidityRaw,
		r.positions[0].transitions[0].afterLiquidityRaw,
	);
	assert.equal(r.positions[0].transitions.length, 2);
});
test("old owner's LP change after transfer refuses", async () => {
	const f = liquidityRangeFixture();
	f.blocks[0].block.transactions.unshift(
		transferEvidenceFixture().transactions[0],
	);
	await assert.rejects(
		replayPositionLiquidityBlockRange(f),
		/current NFT ownership/,
	);
});
test("new-owner change preceding transfer refuses", async () => {
	const f = liquidityRangeFixture({
		ownerWallet: "11111111111111111111111111111113",
		tokenAccountAddress: "11111111111111111111111111111114",
	});
	f.blocks[0].block.transactions.push(
		transferEvidenceFixture().transactions[0],
	);
	await assert.rejects(
		replayPositionLiquidityBlockRange(f),
		/current NFT ownership/,
	);
});
test("LP mutation after closure refuses even with independently valid event", async () => {
	const f = liquidityRangeFixture({ baselineLiquidityRaw: "0" });
	f.blocks[0].block.transactions.unshift(
		closureEvidenceFixture().transactions[0],
	);
	await assert.rejects(
		replayPositionLiquidityBlockRange(f),
		/terminal closure/,
	);
});
test("empty provided range retains baseline", async () => {
	const f = liquidityRangeFixture();
	f.producedSlots = [];
	f.blocks = [];
	const r = await replayPositionLiquidityBlockRange(f);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "100");
	assert.deepEqual(r.positions[0].transitions, []);
});
for (const [label, opts] of [
	["underflow", { kind: "decrease_liquidity", delta: "101" }],
	["overflow", { baselineLiquidityRaw: ((1n << 128n) - 1n).toString() }],
	["zero delta", { delta: "0" }],
])
	test(`refuses ${label}`, async () => {
		await assert.rejects(
			replayPositionLiquidityBlockRange(liquidityRangeFixture(opts)),
			/underflow|overflow|positive/,
		);
	});
for (const [label, alter] of [
	[
		"prefix gap",
		(f) => {
			f.startSlot = 14;
		},
	],
	[
		"missing block",
		(f) => {
			f.blocks = [];
		},
	],
	[
		"unknown instruction",
		(f) => {
			f.blocks[0].block.transactions[0].transaction.message.instructions[0].data =
				bs58.encode(Buffer.alloc(40));
		},
	],
	[
		"missing event",
		(f) => {
			f.blocks[0].block.transactions[0].meta.logMessages.splice(1, 1);
		},
	],
	[
		"argument mismatch",
		(f) => {
			const ix =
				f.blocks[0].block.transactions[0].transaction.message.instructions[0];
			const b = Buffer.from(bs58.decode(ix.data));
			b[8] = 8;
			ix.data = bs58.encode(b);
		},
	],
	[
		"argument trailing bytes",
		(f) => {
			const ix =
				f.blocks[0].block.transactions[0].transaction.message.instructions[0];
			ix.data = bs58.encode(
				Buffer.concat([Buffer.from(bs58.decode(ix.data)), Buffer.from([0])]),
			);
		},
	],
	[
		"wrong NFT mint",
		(f) => {
			for (const rows of [
				f.blocks[0].block.transactions[0].meta.preTokenBalances,
				f.blocks[0].block.transactions[0].meta.postTokenBalances,
			])
				rows[0].mint = "11111111111111111111111111111115";
		},
	],
	[
		"duplicate signature",
		(f) => {
			f.blocks[0].block.transactions.push(f.blocks[0].block.transactions[0]);
		},
	],
])
	test(`refuses ${label}`, async () => {
		const f = liquidityRangeFixture();
		alter(f);
		await assert.rejects(replayPositionLiquidityBlockRange(f));
	});
test("caller mutation after invocation cannot replace the checked evidence", async () => {
	const f = liquidityRangeFixture(),
		pending = replayPositionLiquidityBlockRange(f);
	f.blocks[0].block.transactions[0].meta.logMessages = [];
	f.blocks[0].block.transactions[0].transaction.signatures[0] = "mutated";
	const r = await pending;
	assert.equal(
		r.liquidityObservations[0].record.signature,
		"synthetic-liquidity",
	);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "107");
});

test("multiple LP instructions replay in instruction order within one transaction", async () => {
	const f = liquidityRangeFixture();
	const first = f.blocks[0].block.transactions[0];
	const second = liquidityRangeFixture({
		kind: "decrease_liquidity",
		delta: "5",
	}).blocks[0].block.transactions[0];
	first.transaction.message.instructions.push(
		second.transaction.message.instructions[0],
	);
	first.meta.logMessages.push(...second.meta.logMessages);
	const r = await replayPositionLiquidityBlockRange(f);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "102");
	assert.deepEqual(
		r.positions[0].transitions.map((e) => e.instructionIndex),
		[0, 1],
	);
});
test("a different NFT account owned by the same wallet cannot replace the anchor", async () => {
	await assert.rejects(
		replayPositionLiquidityBlockRange(
			liquidityRangeFixture({
				tokenAccountAddress: "11111111111111111111111111111115",
			}),
		),
		/current NFT ownership/,
	);
});
test("changed ticks refuse even when the event and instruction delta agree", async () => {
	const f = liquidityRangeFixture(),
		logs = f.blocks[0].block.transactions[0].meta.logMessages;
	const event = Buffer.from(logs[1].slice("Program data: ".length), "base64");
	event.writeInt32LE(-99, 72);
	logs[1] = `Program data: ${event.toString("base64")}`;
	await assert.rejects(replayPositionLiquidityBlockRange(f), /ticks differ/);
});
test("decreasing time in a block without observations still refuses", async () => {
	const f = liquidityRangeFixture(),
		block = f.blocks[0].block;
	f.endSlot = 21;
	f.producedSlots.push(21);
	f.blocks.push({
		slot: 21,
		block: {
			...block,
			parentSlot: 20,
			previousBlockhash: block.blockhash,
			blockhash: "11111111111111111111111111111113",
			blockTime: 999,
			transactions: [],
		},
	});
	await assert.rejects(replayPositionLiquidityBlockRange(f), /nonmonotonic/);
});
test("maximum u128 liquidity stays exact without claiming USD value", async () => {
	const max = ((1n << 128n) - 1n).toString();
	const r = await replayPositionLiquidityBlockRange(
		liquidityRangeFixture({ baselineLiquidityRaw: "0", delta: max }),
	);
	assert.equal(r.positions[0].endSlotLiquidityRaw, max);
	assert.equal(r.positions[0].valueUsdCents, undefined);
});
test("identical supplied evidence returns the same replay identity", async () => {
	const f = liquidityRangeFixture();
	assert.equal(
		(await replayPositionLiquidityBlockRange(f)).replaySha256,
		(await replayPositionLiquidityBlockRange(f)).replaySha256,
	);
});
