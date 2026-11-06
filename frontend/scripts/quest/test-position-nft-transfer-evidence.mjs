import assert from "node:assert/strict";
import test from "node:test";
import {
	createTransferCheckedInstruction,
	createTransferInstruction,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	AddressLookupTableAccount,
	PublicKey,
	Transaction,
	TransactionMessage,
} from "@solana/web3.js";
import bs58 from "bs58";
import { positionBaselineFixture } from "../../tests/fixtures/quest-position-baseline.mjs";
import { decodePositionNftTransferEvidence } from "./position-nft-transfer-evidence.mjs";

function fixture({ checked = true, sameOwner = false } = {}) {
	const baseline = positionBaselineFixture();
	const owner = new PublicKey("11111111111111111111111111111111");
	const destinationOwner = sameOwner
		? owner
		: new PublicKey("11111111111111111111111111111112");
	const source = new PublicKey(baseline.tokenAccount.address);
	const destination = new PublicKey("11111111111111111111111111111113");
	const mint = new PublicKey(baseline.mintAccount.address);
	const ix = checked
		? createTransferCheckedInstruction(source, mint, destination, owner, 1n, 0)
		: createTransferInstruction(source, destination, owner, 1n);
	const tx = new Transaction({
		feePayer: owner,
		recentBlockhash: owner.toBase58(),
	}).add(ix);
	const message = tx.compileMessage();
	const index = (address) =>
		message.staticAccountKeys.findIndex((key) => key.equals(address));
	const balance = (address, owner, amount) => ({
		accountIndex: index(address),
		mint: mint.toBase58(),
		owner: owner.toBase58(),
		programId: TOKEN_PROGRAM_ID.toBase58(),
		uiTokenAmount: {
			amount,
			decimals: 0,
			uiAmount: null,
			uiAmountString: amount,
		},
	});
	return {
		network: "DEVNET",
		finality: "finalized",
		campaignId: "transfer-fixture",
		programId: baseline.programId,
		slot: 20,
		blockTimeSeconds: 1000,
		inventory: [
			{
				positionAddress: baseline.positionAccount.address,
				positionMint: mint.toBase58(),
				tokenAccountAddress: source.toBase58(),
			},
		],
		transactions: [
			{
				slot: 20,
				transactionIndex: 0,
				blockTime: 1000,
				transaction: { signatures: ["fixture-signature"], message },
				meta: {
					err: null,
					innerInstructions: [],
					preTokenBalances: [
						balance(source, owner, "1"),
						balance(destination, destinationOwner, "0"),
					],
					postTokenBalances: [
						balance(source, owner, "0"),
						balance(destination, destinationOwner, "1"),
					],
				},
			},
		],
	};
}
const response = (f) => f.transactions[0];
const meta = (f) => response(f).meta;
function data(f, mutate) {
	const ix = response(f).transaction.message.instructions[0];
	const bytes = Buffer.from(bs58.decode(ix.data));
	mutate(bytes);
	ix.data = bs58.encode(bytes);
}
test("direct checked legacy NFT transfer binds owners/accounts/instruction and exact raw amount", () => {
	const f = fixture(),
		result = decodePositionNftTransferEvidence(f),
		row = result.transfers[0];
	assert.equal(result.state, "TEST_ONLY_POSITION_NFT_TRANSFERS");
	assert.equal(result.awardEligible, false);
	assert.equal(result.coverage, "PROVIDED_TRANSACTIONS_ONLY");
	assert.equal(row.record.amountRaw, "1");
	assert.equal(row.record.fromOwnerWallet, meta(f).preTokenBalances[0].owner);
	assert.equal(row.record.toOwnerWallet, meta(f).preTokenBalances[1].owner);
	assert.equal(row.record.positionAddress, f.inventory[0].positionAddress);
	assert.equal(row.record.instructionKind, "transfer_checked");
	assert.equal(row.record.instructionIndex, 0);
	assert.match(row.evidenceSha256, /^[0-9a-f]{64}$/);
	assert.equal("ownershipIntervals" in result, false);
});
test("unchecked legacy transfer and same-owner token-account movement are supported", () => {
	const result = decodePositionNftTransferEvidence(
		fixture({ checked: false, sameOwner: true }),
	);
	assert.equal(result.transfers[0].record.instructionKind, "transfer");
	assert.equal(
		result.transfers[0].record.fromOwnerWallet,
		result.transfers[0].record.toOwnerWallet,
	);
});
test("exact transaction replay deduplicates globally; conflicting replay fails", () => {
	const f = fixture();
	const expected = decodePositionNftTransferEvidence(f);
	f.transactions.push(f.transactions[0]);
	assert.deepEqual(decodePositionNftTransferEvidence(f), expected);
	const other = fixture();
	meta(other).preTokenBalances[1].owner = meta(
		other,
	).postTokenBalances[1].owner = "11111111111111111111111111111114";
	f.transactions = [response(f), response(other)];
	assert.throws(
		() => decodePositionNftTransferEvidence(f),
		/conflicting source/,
	);
});
test("stable NFT balances with a non-token read instruction do not invent a transfer", () => {
	const f = fixture();
	meta(f).postTokenBalances = structuredClone(meta(f).preTokenBalances);
	const message = response(f).transaction.message;
	message.instructions[0].programIdIndex = 0;
	assert.deepEqual(decodePositionNftTransferEvidence(f).transfers, []);
});
test("empty transaction list has no claimed transfer or continuous coverage", () => {
	const f = fixture();
	f.transactions = [];
	assert.deepEqual(decodePositionNftTransferEvidence(f).transfers, []);
});

test("block transaction index collisions are refused independently of source signature", () => {
	const f = fixture(),
		other = fixture();
	response(other).transaction.signatures[0] = "other-signature";
	f.transactions.push(response(other));
	assert.throws(
		() => decodePositionNftTransferEvidence(f),
		/conflicting block/,
	);
});
test("missing transaction index and malformed account indices are refused", () => {
	const f = fixture();
	delete response(f).transactionIndex;
	assert.throws(() => decodePositionNftTransferEvidence(f), /matching RPC/);
	const other = fixture();
	response(other).transaction.message.instructions[0].accounts[0] = -1;
	assert.throws(
		() => decodePositionNftTransferEvidence(other),
		/outer instruction/,
	);
});

test("versioned transaction resolves loaded destination accounts and refuses missing lookup data", () => {
	const f = fixture(),
		tx = response(f).transaction,
		oldKeys = tx.message.staticAccountKeys;
	const lookup = new AddressLookupTableAccount({
		key: new PublicKey("11111111111111111111111111111114"),
		state: {
			deactivationSlot: 18446744073709551615n,
			lastExtendedSlot: 0,
			lastExtendedSlotStartIndex: 0,
			addresses: [new PublicKey("11111111111111111111111111111113")],
		},
	});
	const v0 = TransactionMessage.decompile(tx.message).compileToV0Message([
		lookup,
	]);
	const loaded = {
		writable: v0.addressTableLookups.flatMap((a) =>
			a.writableIndexes.map((i) => lookup.state.addresses[i]),
		),
		readonly: v0.addressTableLookups.flatMap((a) =>
			a.readonlyIndexes.map((i) => lookup.state.addresses[i]),
		),
	};
	assert.equal(loaded.writable.length, 1);
	const keys = [
		...v0.staticAccountKeys,
		...loaded.writable,
		...loaded.readonly,
	];
	for (const row of [...meta(f).preTokenBalances, ...meta(f).postTokenBalances])
		row.accountIndex = keys.findIndex((key) =>
			key.equals(oldKeys[row.accountIndex]),
		);
	tx.message = v0;
	meta(f).loadedAddresses = loaded;
	assert.equal(decodePositionNftTransferEvidence(f).transfers.length, 1);
	delete meta(f).loadedAddresses;
	assert.throws(() => decodePositionNftTransferEvidence(f), /index|accounts/);
});
for (const [name, mutate, pattern] of [
	[
		"Mainnet",
		(f) => {
			f.network = "MAINNET";
		},
		/Devnet/,
	],
	[
		"unfinalized",
		(f) => {
			f.finality = "confirmed";
		},
		/finalized/,
	],
	[
		"wrong context slot",
		(f) => {
			response(f).slot++;
		},
		/matching RPC/,
	],
	[
		"wrong context time",
		(f) => {
			response(f).blockTime++;
		},
		/matching RPC/,
	],
	[
		"failed transaction",
		(f) => {
			meta(f).err = { InstructionError: [0, "Custom"] };
		},
		/successful/,
	],
	[
		"missing inner metadata",
		(f) => {
			delete meta(f).innerInstructions;
		},
		/inner instructions/,
	],
	[
		"missing pre balances",
		(f) => {
			delete meta(f).preTokenBalances;
		},
		/complete token/,
	],
	[
		"duplicate balance",
		(f) => {
			meta(f).preTokenBalances.push(meta(f).preTokenBalances[0]);
		},
		/duplicate/,
	],
	[
		"wrong selected PDA",
		(f) => {
			f.inventory[0].positionAddress = "11111111111111111111111111111111";
		},
		/inventory/,
	],
	[
		"duplicate selected inventory",
		(f) => {
			f.inventory.push(f.inventory[0]);
		},
		/duplicate selected/,
	],
	[
		"Token2022 balance",
		(f) => {
			meta(f).preTokenBalances[0].programId =
				"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
		},
		/legacy/,
	],
	[
		"wrong NFT decimals",
		(f) => {
			meta(f).preTokenBalances[0].uiTokenAmount.decimals = 1;
		},
		/zero-decimal/,
	],
	[
		"wrong transfer amount",
		(f) =>
			data(f, (b) => {
				b.writeBigUInt64LE(2n, 1);
			}),
		/unsupported/,
	],
	[
		"wrong checked decimals",
		(f) =>
			data(f, (b) => {
				b[9] = 1;
			}),
		/unsupported/,
	],
	[
		"NFT burn opcode",
		(f) =>
			data(f, (b) => {
				b[0] = 8;
			}),
		/unsupported/,
	],
	[
		"authority reassignment opcode",
		(f) =>
			data(f, (b) => {
				b[0] = 6;
			}),
		/unsupported/,
	],
	[
		"NFT close opcode",
		(f) =>
			data(f, (b) => {
				b[0] = 9;
			}),
		/unsupported/,
	],
	[
		"unsigned source owner",
		(f) => {
			response(f).transaction.message.header.numRequiredSignatures = 0;
		},
		/signer/,
	],
	[
		"delegate instead of owner",
		(f) => {
			meta(f).preTokenBalances[0].owner = meta(f).postTokenBalances[0].owner =
				"11111111111111111111111111111114";
		},
		/signer/,
	],
	[
		"owner changes within transfer",
		(f) => {
			meta(f).postTokenBalances[0].owner = "11111111111111111111111111111114";
		},
		/ownership/,
	],
	[
		"missing destination baseline",
		(f) => {
			meta(f).preTokenBalances.pop();
		},
		/ownership/,
	],
	[
		"wrong final destination balance",
		(f) => {
			meta(f).postTokenBalances[1].uiTokenAmount.amount = "0";
		},
		/transition/,
	],
	[
		"two direct moves of one NFT",
		(f) => {
			response(f).transaction.message.instructions.push({
				...response(f).transaction.message.instructions[0],
			});
		},
		/multiple moves/,
	],
	[
		"unexplained balance movement",
		(f) => {
			response(f).transaction.message.instructions[0].programIdIndex = 0;
		},
		/unexplained/,
	],
	[
		"CPI NFT mutation",
		(f) => {
			const ix = response(f).transaction.message.instructions[0];
			meta(f).innerInstructions = [
				{
					index: 0,
					instructions: [
						{
							programIdIndex: ix.programIdIndex,
							accounts: [...ix.accounts],
							data: ix.data,
						},
					],
				},
			];
		},
		/CPI/,
	],
	[
		"input overflow",
		(f) => {
			f.transactions = Array(2049).fill(response(f));
		},
		/bounded/,
	],
])
	test(`transfer decoder refuses ${name}`, () => {
		const f = fixture();
		mutate(f);
		assert.throws(() => decodePositionNftTransferEvidence(f), pattern);
	});
