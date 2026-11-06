import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	createBurnCheckedInstruction,
	createBurnInstruction,
	createCloseAccountInstruction,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	AddressLookupTableAccount,
	PublicKey,
	Transaction,
	TransactionInstruction,
	TransactionMessage,
} from "@solana/web3.js";
import bs58 from "bs58";
import { positionBaselineFixture } from "../../tests/fixtures/quest-position-baseline.mjs";
import { decodePositionClosureEvidence as decode } from "./position-closure-evidence.mjs";

// Synthetic message and RPC metadata, not a captured chain transaction.
function fixture({ checked = false } = {}) {
	const baseline = positionBaselineFixture();
	const owner = new PublicKey("11111111111111111111111111111111");
	const token = new PublicKey("11111111111111111111111111111112");
	const mint = new PublicKey(baseline.mintAccount.address);
	const position = new PublicKey(baseline.positionAccount.address);
	const ix = new TransactionInstruction({
		programId: new PublicKey(baseline.programId),
		keys: [
			{ pubkey: owner, isSigner: true, isWritable: false },
			{ pubkey: owner, isSigner: false, isWritable: true },
			{ pubkey: position, isSigner: false, isWritable: true },
			{ pubkey: mint, isSigner: false, isWritable: true },
			{ pubkey: token, isSigner: false, isWritable: true },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		],
		data: createHash("sha256")
			.update("global:close_position")
			.digest()
			.subarray(0, 8),
	});
	const message = new Transaction({
		feePayer: owner,
		recentBlockhash: owner.toBase58(),
	})
		.add(ix)
		.compileMessage();
	const index = (key) =>
		message.staticAccountKeys.findIndex((k) => k.equals(key));
	const inner = (instruction) => ({
		programIdIndex: index(instruction.programId),
		accounts: instruction.keys.map((k) => index(k.pubkey)),
		data: bs58.encode(instruction.data),
		stackHeight: 2,
	});
	const preBalances = message.staticAccountKeys.map(() => 100);
	const postBalances = [...preBalances];
	postBalances[index(position)] = postBalances[index(token)] = 0;
	return {
		network: "DEVNET",
		finality: "finalized",
		campaignId: "closure-fixture",
		programId: baseline.programId,
		slot: 20,
		blockTimeSeconds: 1000,
		inventory: [
			{
				positionAddress: position.toBase58(),
				positionMint: mint.toBase58(),
				tokenAccountAddress: token.toBase58(),
			},
		],
		transactions: [
			{
				slot: 20,
				blockTime: 1000,
				transactionIndex: 0,
				transaction: { signatures: ["synthetic-close"], message },
				meta: {
					err: null,
					preBalances,
					postBalances,
					preTokenBalances: [
						{
							accountIndex: index(token),
							mint: mint.toBase58(),
							owner: owner.toBase58(),
							programId: TOKEN_PROGRAM_ID.toBase58(),
							uiTokenAmount: { amount: "1", decimals: 0 },
						},
					],
					postTokenBalances: [],
					innerInstructions: [
						{
							index: 0,
							instructions: [
								inner(
									checked
										? createBurnCheckedInstruction(token, mint, owner, 1n, 0)
										: createBurnInstruction(token, mint, owner, 1n),
								),
								inner(createCloseAccountInstruction(token, owner, owner)),
							],
						},
					],
				},
			},
		],
	};
}
const rpc = (f) => f.transactions[0];
const meta = (f) => rpc(f).meta;
const inner = (f) => meta(f).innerInstructions[0].instructions;
const outer = (f) => rpc(f).transaction.message.instructions[0];
function burnData(f, change) {
	const bytes = Buffer.from(bs58.decode(inner(f)[0].data));
	change(bytes);
	inner(f)[0].data = bs58.encode(bytes);
}

test("legacy close binds the owner, burn, token closure and terminal position lamports", () => {
	const f = fixture();
	const result = decode(f);
	const row = result.closures[0];
	assert.equal(result.state, "TEST_ONLY_POSITION_CLOSURES");
	assert.equal(result.awardEligible, false);
	assert.equal(result.coverage, "PROVIDED_TRANSACTIONS_ONLY");
	assert.equal(row.record.positionAddress, f.inventory[0].positionAddress);
	assert.equal(
		row.record.observedOwnerWallet,
		meta(f).preTokenBalances[0].owner,
	);
	assert.equal(row.record.burnAmountRaw, "1");
	assert.equal(row.record.burnInstructionKind, "burn");
	assert.match(row.evidenceSha256, /^[0-9a-f]{64}$/);
	assert.equal("liquidityRaw" in row.record, false);
	assert.equal("ownershipIntervals" in result, false);
});
test("BurnChecked with zero decimals is supported", () =>
	assert.equal(
		decode(fixture({ checked: true })).closures[0].record.burnInstructionKind,
		"burn_checked",
	));
test("explicit zero post token row is accepted", () => {
	const f = fixture();
	meta(f).postTokenBalances = [structuredClone(meta(f).preTokenBalances[0])];
	meta(f).postTokenBalances[0].uiTokenAmount.amount = "0";
	assert.equal(decode(f).closures.length, 1);
});
test("exact replay deduplicates and changed source ordering conflicts", () => {
	const f = fixture();
	const expected = decode(f);
	f.transactions.push(rpc(f));
	assert.deepEqual(decode(f), expected);
	const other = fixture();
	rpc(other).transactionIndex = 1;
	f.transactions = [rpc(f), rpc(other)];
	assert.throws(() => decode(f), /conflicting source replay/);
});
test("empty supplied transactions claim no closures", () => {
	const f = fixture();
	f.transactions = [];
	assert.deepEqual(decode(f).closures, []);
});

const refusals = [
	[
		"Mainnet",
		(f) => {
			f.network = "MAINNET";
		},
	],
	[
		"unfinalized",
		(f) => {
			f.finality = "confirmed";
		},
	],
	[
		"wrong PDA",
		(f) => {
			f.inventory[0].positionAddress = "11111111111111111111111111111113";
		},
	],
	[
		"duplicate inventory",
		(f) => {
			f.inventory.push(f.inventory[0]);
		},
	],
	[
		"failed transaction",
		(f) => {
			meta(f).err = { InstructionError: [0, "Custom"] };
		},
	],
	[
		"slot mismatch",
		(f) => {
			rpc(f).slot++;
		},
	],
	[
		"time mismatch",
		(f) => {
			rpc(f).blockTime++;
		},
	],
	[
		"missing block index",
		(f) => {
			delete rpc(f).transactionIndex;
		},
	],
	[
		"missing inner metadata",
		(f) => {
			delete meta(f).innerInstructions;
		},
	],
	[
		"missing lamports",
		(f) => {
			delete meta(f).preBalances;
		},
	],
	[
		"unsafe lamports",
		(f) => {
			meta(f).preBalances[0] = Number.MAX_SAFE_INTEGER + 1;
		},
	],
	[
		"partial lamports",
		(f) => {
			meta(f).postBalances.pop();
		},
	],
	[
		"position still exists",
		(f) => {
			meta(f).postBalances[outer(f).accounts[2]] = 1;
		},
	],
	[
		"token account still exists",
		(f) => {
			meta(f).postBalances[outer(f).accounts[4]] = 1;
		},
	],
	[
		"position absent before",
		(f) => {
			meta(f).preBalances[outer(f).accounts[2]] = 0;
		},
	],
	[
		"wrong NFT owner",
		(f) => {
			meta(f).preTokenBalances[0].owner = "11111111111111111111111111111113";
		},
	],
	[
		"missing pre NFT",
		(f) => {
			meta(f).preTokenBalances = [];
		},
	],
	[
		"missing post NFT metadata",
		(f) => {
			delete meta(f).postTokenBalances;
		},
	],
	[
		"NFT not burned",
		(f) => {
			meta(f).postTokenBalances = structuredClone(meta(f).preTokenBalances);
		},
	],
	[
		"NFT decimal mismatch",
		(f) => {
			meta(f).preTokenBalances[0].uiTokenAmount.decimals = 1;
		},
	],
	[
		"NFT token program mismatch",
		(f) => {
			meta(f).preTokenBalances[0].programId = f.programId;
		},
	],
	[
		"duplicate balance",
		(f) => {
			meta(f).preTokenBalances.push(meta(f).preTokenBalances[0]);
		},
	],
	[
		"invalid balance index",
		(f) => {
			meta(f).preTokenBalances[0].accountIndex = 999;
		},
	],
	[
		"wrong outer program",
		(f) => {
			outer(f).programIdIndex = outer(f).accounts[5];
		},
	],
	[
		"unknown outer instruction",
		(f) => {
			outer(f).data = bs58.encode(Buffer.alloc(8));
		},
	],
	[
		"extra outer account",
		(f) => {
			outer(f).accounts.push(0);
		},
	],
	[
		"non signer",
		(f) => {
			rpc(f).transaction.message.header.numRequiredSignatures = 0;
		},
	],
	[
		"readonly position",
		(f) => {
			rpc(f).transaction.message.header.numReadonlyUnsignedAccounts =
				rpc(f).transaction.message.staticAccountKeys.length - 1;
		},
	],
	["wrong burn amount", (f) => burnData(f, (b) => b.writeBigUInt64LE(2n, 1))],
	[
		"unknown burn opcode",
		(f) =>
			burnData(f, (b) => {
				b[0] = 3;
			}),
	],
	[
		"short burn data",
		(f) => {
			inner(f)[0].data = bs58.encode(Buffer.from([8]));
		},
	],
	[
		"wrong burn account",
		(f) => {
			inner(f)[0].accounts[0] = 0;
		},
	],
	[
		"wrong close receiver",
		(f) => {
			inner(f)[1].accounts[1] = outer(f).accounts[2];
		},
	],
	[
		"unknown close opcode",
		(f) => {
			inner(f)[1].data = bs58.encode(Buffer.from([8]));
		},
	],
	[
		"reordered CPI",
		(f) => {
			inner(f).reverse();
		},
	],
	[
		"extra CPI",
		(f) => {
			inner(f).push(inner(f)[1]);
		},
	],
	[
		"nested burn",
		(f) => {
			inner(f)[0].stackHeight = 3;
		},
	],
	[
		"missing stack depth",
		(f) => {
			delete inner(f)[0].stackHeight;
		},
	],
	[
		"wrong CPI program",
		(f) => {
			inner(f)[0].programIdIndex = outer(f).programIdIndex;
		},
	],
	[
		"invalid CPI account index",
		(f) => {
			inner(f)[0].accounts[0] = 999;
		},
	],
	[
		"duplicate inner group",
		(f) => {
			meta(f).innerInstructions.push(meta(f).innerInstructions[0]);
		},
	],
	[
		"wrong group index",
		(f) => {
			meta(f).innerInstructions[0].index = 1;
		},
	],
];
for (const [name, change] of refusals)
	test(`rejects ${name}`, () => {
		const f = fixture();
		change(f);
		assert.throws(() => decode(f));
	});
test("checked burn decimal mismatch rejects", () => {
	const f = fixture({ checked: true });
	burnData(f, (b) => {
		b[9] = 1;
	});
	assert.throws(() => decode(f));
});
test("block transaction index collision rejects", () => {
	const f = fixture(),
		other = fixture();
	rpc(other).transaction.signatures[0] = "other";
	f.transactions.push(rpc(other));
	assert.throws(() => decode(f), /conflicting block/);
});

function versionedFixture() {
	const f = fixture();
	const previous = rpc(f).transaction.message;
	const ix = TransactionMessage.decompile(previous).instructions[0];
	const lookup = new AddressLookupTableAccount({
		key: new PublicKey("11111111111111111111111111111114"),
		state: {
			deactivationSlot: 18446744073709551615n,
			lastExtendedSlot: 0,
			lastExtendedSlotStartIndex: 0,
			authority: undefined,
			addresses: ix.keys.slice(2, 5).map((k) => k.pubkey),
		},
	});
	const message = new TransactionMessage({
		payerKey: previous.staticAccountKeys[0],
		recentBlockhash: previous.recentBlockhash,
		instructions: [ix],
	}).compileToV0Message([lookup]);
	const resolved = message.getAccountKeys({
		addressLookupTableAccounts: [lookup],
	});
	const keys = Array.from({ length: resolved.length }, (_, i) =>
		resolved.get(i),
	);
	const remap = (i) =>
		keys.findIndex((k) => k.equals(previous.staticAccountKeys[i]));
	for (const instruction of inner(f)) {
		instruction.programIdIndex = remap(instruction.programIdIndex);
		instruction.accounts = instruction.accounts.map(remap);
	}
	meta(f).preTokenBalances[0].accountIndex = remap(
		meta(f).preTokenBalances[0].accountIndex,
	);
	for (const field of ["preBalances", "postBalances"]) {
		const old = meta(f)[field];
		meta(f)[field] = keys.map(
			(key) => old[previous.staticAccountKeys.findIndex((k) => k.equals(key))],
		);
	}
	meta(f).loadedAddresses = resolved.accountKeysFromLookups;
	rpc(f).transaction.message = message;
	return f;
}
test("versioned closure resolves loaded position, mint and token keys", () =>
	assert.equal(decode(versionedFixture()).closures.length, 1));
test("missing versioned lookup addresses rejects", () => {
	const f = versionedFixture();
	delete meta(f).loadedAddresses;
	assert.throws(() => decode(f), /loaded addresses/);
});
test("extra legacy loaded addresses rejects", () => {
	const f = fixture();
	meta(f).loadedAddresses = {
		writable: [new PublicKey(f.programId)],
		readonly: [],
	};
	assert.throws(() => decode(f), /loaded addresses/);
});
test("tracked NFT CPI under an unrelated outer instruction rejects", () => {
	const f = fixture();
	outer(f).accounts = [0];
	outer(f).programIdIndex = 0;
	assert.throws(() => decode(f), /unsupported tracked-position CPI/);
});
test("unexplained NFT disappearance without closure rejects", () => {
	const f = fixture();
	outer(f).accounts = [0];
	outer(f).programIdIndex = 0;
	meta(f).innerInstructions = [];
	assert.throws(() => decode(f), /unexplained NFT/);
});
