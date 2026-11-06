import assert from "node:assert/strict";
import test from "node:test";
import {
	ownershipBlockConnection,
	ownershipBlockRangeFixture,
} from "../../tests/fixtures/quest-ownership-block-range.mjs";
import {
	closureEvidenceFixture,
	transferEvidenceFixture,
} from "../../tests/fixtures/quest-position-ownership.mjs";
import {
	createPositionOwnershipBlockReader,
	decodePositionOwnershipBlockRange as decode,
} from "./position-ownership-block-range.mjs";

test("complete supplied block claims retain skipped slots and actual full-block index", () => {
	const f = ownershipBlockRangeFixture();
	f.blocks[0].block.transactions[0].transactionIndex = 999;
	const r = decode(f);
	assert.equal(r.observations[0].record.transactionIndex, 0);
	assert.deepEqual(r.producedSlots, [20]);
	assert.equal(r.awardEligible, false);
	assert.equal(r.coverage, "PROVIDED_FINALIZED_BLOCK_RANGE");
	assert.match(r.rangeSha256, /^[0-9a-f]{64}$/);
});
test("failed attempts do not change ownership and keep later transaction indices", () => {
	const f = ownershipBlockRangeFixture();
	f.blocks[0].block.transactions.unshift({
		transaction: { signatures: ["failed-attempt"] },
		meta: { err: { InstructionError: [0, "Custom"] } },
	});
	const r = decode(f);
	assert.equal(r.observations.length, 1);
	assert.equal(r.observations[0].record.transactionIndex, 1);
	assert.equal(r.blocks[0].transactions[0].failed, true);
});
test("direct close routes to the narrow closure decoder", () => {
	const f = ownershipBlockRangeFixture();
	f.blocks[0].block.transactions = closureEvidenceFixture().transactions;
	assert.equal(
		decode(f).observations[0].record.eventKind,
		"position_close_observed",
	);
});
test("empty produced range explicitly retains bounds without observations", () => {
	const f = ownershipBlockRangeFixture();
	f.producedSlots = [];
	f.blocks = [];
	const r = decode(f);
	assert.equal(r.startSlot, 13);
	assert.equal(r.endSlot, 20);
	assert.deepEqual(r.observations, []);
});
test("connected produced blocks can span skipped slots", () => {
	const f = ownershipBlockRangeFixture();
	const response = transferEvidenceFixture().transactions[0];
	response.transaction.signatures[0] = "second-block-transfer";
	f.endSlot = 23;
	f.producedSlots.push(23);
	f.blocks.push({
		slot: 23,
		block: {
			blockhash: "11111111111111111111111111111113",
			previousBlockhash: f.blocks[0].block.blockhash,
			parentSlot: 20,
			blockTime: 1001,
			transactions: [response],
		},
	});
	assert.equal(decode(f).observations.length, 2);
});
for (const [name, change] of [
	[
		"pre-anchor start",
		(f) => {
			f.startSlot = 12;
		},
	],
	[
		"oversized slot range",
		(f) => {
			f.endSlot = 269;
		},
	],
	[
		"end overflow",
		(f) => {
			f.endSlot = Number.MAX_SAFE_INTEGER;
		},
	],
	[
		"missing full block",
		(f) => {
			f.blocks = [];
		},
	],
	[
		"out-of-range slot",
		(f) => {
			f.producedSlots = [21];
		},
	],
	[
		"duplicate slot",
		(f) => {
			f.producedSlots.push(20);
			f.blocks.push(f.blocks[0]);
		},
	],
	[
		"wrong block slot",
		(f) => {
			f.blocks[0].slot = 19;
		},
	],
	[
		"null block",
		(f) => {
			f.blocks[0].block = null;
		},
	],
	[
		"missing transactions",
		(f) => {
			delete f.blocks[0].block.transactions;
		},
	],
	[
		"missing block time",
		(f) => {
			f.blocks[0].block.blockTime = null;
		},
	],
	[
		"negative block time",
		(f) => {
			f.blocks[0].block.blockTime = -1;
		},
	],
	[
		"parent omitted from claimed range",
		(f) => {
			f.blocks[0].block.parentSlot = 19;
		},
	],
	[
		"invalid hash",
		(f) => {
			f.blocks[0].block.blockhash = "bad";
		},
	],
	[
		"missing metadata",
		(f) => {
			f.blocks[0].block.transactions[0].meta = null;
		},
	],
	[
		"missing failure status",
		(f) => {
			delete f.blocks[0].block.transactions[0].meta.err;
		},
	],
	[
		"malformed failure status",
		(f) => {
			f.blocks[0].block.transactions[0].meta.err = false;
		},
	],
	[
		"duplicate signature",
		(f) => {
			f.blocks[0].block.transactions.push(f.blocks[0].block.transactions[0]);
		},
	],
	[
		"oversized transaction list",
		(f) => {
			f.blocks[0].block.transactions = Array(2049).fill(
				f.blocks[0].block.transactions[0],
			);
		},
	],
	[
		"missing NFT balance metadata",
		(f) => {
			delete f.blocks[0].block.transactions[0].meta.preTokenBalances;
		},
	],
	[
		"unsupported burn profile",
		(f) => {
			const tx = closureEvidenceFixture().transactions[0];
			tx.transaction.message.instructions[0].data = "11111111";
			f.blocks[0].block.transactions = [tx];
		},
	],
])
	test(`block range refuses ${name}`, () => {
		const f = ownershipBlockRangeFixture();
		change(f);
		assert.throws(() => decode(f));
	});
test("reader pins finalized requests and full transaction details", async () => {
	const f = ownershipBlockRangeFixture(),
		calls = [];
	const r = await createPositionOwnershipBlockReader({
		connection: ownershipBlockConnection(f, calls),
		anchor: f.anchor,
	}).read(f);
	assert.equal(r.observations.length, 1);
	assert.deepEqual(calls[0], { method: "getSlot", commitment: "finalized" });
	assert.equal(calls[2].commitment, "finalized");
	assert.deepEqual(calls[3].options, {
		commitment: "finalized",
		transactionDetails: "full",
		maxSupportedTransactionVersion: 1,
		rewards: false,
	});
});
test("reader refuses range beyond finalized head before block requests", async () => {
	const f = ownershipBlockRangeFixture(),
		calls = [],
		connection = ownershipBlockConnection(f, calls);
	connection.getSlot = async () => 19;
	await assert.rejects(
		createPositionOwnershipBlockReader({ connection, anchor: f.anchor }).read(
			f,
		),
		/finalized head/,
	);
	assert.equal(calls.length, 0);
});
test("reader refuses malformed produced slots before fetching blocks", async () => {
	const f = ownershipBlockRangeFixture(),
		calls = [],
		connection = ownershipBlockConnection(f, calls);
	connection.getBlocks = async () => [20, 20];
	await assert.rejects(
		createPositionOwnershipBlockReader({ connection, anchor: f.anchor }).read(
			f,
		),
		/produced slots/,
	);
	assert.equal(
		calls.some((c) => c.method === "getBlock"),
		false,
	);
});
test("missing block response propagates refusal", async () => {
	const f = ownershipBlockRangeFixture(),
		connection = ownershipBlockConnection(f);
	connection.getBlock = async () => null;
	await assert.rejects(
		createPositionOwnershipBlockReader({ connection, anchor: f.anchor }).read(
			f,
		),
		/full block/,
	);
});

test("reader refuses known pruned history before produced-slot requests", async () => {
	const f = ownershipBlockRangeFixture(),
		calls = [],
		connection = ownershipBlockConnection(f, calls);
	connection.getFirstAvailableBlock = async () => 14;
	await assert.rejects(
		createPositionOwnershipBlockReader({ connection, anchor: f.anchor }).read(
			f,
		),
		/pruned/,
	);
	assert.equal(
		calls.some((c) => c.method === "getBlocks"),
		false,
	);
});
test("later block must link to the previous produced hash and slot", () => {
	const f = ownershipBlockRangeFixture();
	f.endSlot = 23;
	f.producedSlots.push(23);
	f.blocks.push({
		slot: 23,
		block: {
			...f.blocks[0].block,
			parentSlot: 20,
			blockhash: "11111111111111111111111111111113",
			previousBlockhash: "11111111111111111111111111111114",
			transactions: [],
		},
	});
	assert.throws(() => decode(f), /parent chain/);
});
