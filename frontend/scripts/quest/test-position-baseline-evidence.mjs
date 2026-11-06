import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { unpackAccount, unpackMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
	createPositionBaselineReader,
	projectPositionBaselineEvidence,
} from "./position-baseline-evidence.mjs";

const programId = "28XTA3cRFetDEdPF1DRTuPWdqFKWbScWMRG94N2u4Tas";
const mintAddress = "So11111111111111111111111111111111111111112";
const wallet = "11111111111111111111111111111111";
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
function fixture() {
	const position = Buffer.alloc(216);
	createHash("sha256")
		.update("account:Position")
		.digest()
		.copy(position, 0, 0, 8);
	new PublicKey(wallet).toBuffer().copy(position, 8);
	new PublicKey(mintAddress).toBuffer().copy(position, 40);
	position.writeBigUInt64LE(3n, 72);
	position.writeBigUInt64LE(1n, 80);
	position.writeInt32LE(-100, 88);
	position.writeInt32LE(100, 92);
	const mint = Buffer.alloc(82);
	mint.writeBigUInt64LE(1n, 36);
	mint[45] = 1;
	const token = Buffer.alloc(165);
	new PublicKey(mintAddress).toBuffer().copy(token, 0);
	new PublicKey(wallet).toBuffer().copy(token, 32);
	token.writeBigUInt64LE(1n, 64);
	token[108] = 1;
	const [address] = PublicKey.findProgramAddressSync(
		[Buffer.from("position"), new PublicKey(mintAddress).toBuffer()],
		new PublicKey(programId),
	);
	const account = (address, owner, data) => ({
		address,
		owner,
		executable: false,
		dataBase64: data.toString("base64"),
	});
	return {
		network: "DEVNET",
		finality: "finalized",
		slot: 12,
		programId,
		layoutVersion: "solve-position-v1",
		positionAccount: account(address.toBase58(), programId, position),
		mintAccount: account(mintAddress, tokenProgram, mint),
		tokenAccount: account(tokenProgram, tokenProgram, token),
	};
}
function bytes(f, field, mutate) {
	const data = Buffer.from(f[field].dataBase64, "base64");
	mutate(data);
	f[field].dataBase64 = data.toString("base64");
}
test("checked baseline preserves exact liquidity and point-in-time ownership", () => {
	const result = projectPositionBaselineEvidence(fixture());
	assert.equal(result.liquidityRaw, ((1n << 64n) + 3n).toString());
	assert.equal(result.observedOwnerWallet, wallet);
	assert.equal(result.ownershipCoverage, "POINT_IN_TIME");
	assert.equal(result.awardEligible, false);
	assert.equal(result.positionMint, mintAddress);
	assert.equal("usdValue" in result, false);
	assert.equal("passportId" in result, false);
	assert.equal("ownershipIntervals" in result, false);
});

test("independent SPL parsers agree with the supported mint and ownership layout", () => {
	const f = fixture();
	const info = (a) => ({
		owner: new PublicKey(a.owner),
		executable: a.executable,
		data: Buffer.from(a.dataBase64, "base64"),
		lamports: 1,
	});
	const mint = unpackMint(
		new PublicKey(f.mintAccount.address),
		info(f.mintAccount),
	);
	const token = unpackAccount(
		new PublicKey(f.tokenAccount.address),
		info(f.tokenAccount),
	);
	const result = projectPositionBaselineEvidence(f);
	assert.equal(mint.supply, 1n);
	assert.equal(mint.decimals, 0);
	assert.equal(mint.isInitialized, true);
	assert.equal(token.mint.toBase58(), result.positionMint);
	assert.equal(token.owner.toBase58(), result.observedOwnerWallet);
	assert.equal(token.amount, 1n);
	assert.equal(token.delegate, null);
	assert.equal(token.isFrozen, false);
});
test("canonical baseline hash is deterministic and binds unused raw fields and slot", () => {
	const f = fixture();
	const original = projectPositionBaselineEvidence(f).evidenceSha256;
	assert.equal(
		projectPositionBaselineEvidence(structuredClone(f)).evidenceSha256,
		original,
	);
	bytes(f, "positionAccount", (b) => {
		b[100] = 1;
	});
	assert.notEqual(projectPositionBaselineEvidence(f).evidenceSha256, original);
	const other = fixture();
	other.slot++;
	assert.notEqual(
		projectPositionBaselineEvidence(other).evidenceSha256,
		original,
	);
});
test("zero and maximum u128 liquidity are observed without inventing duration", () => {
	for (const amount of [0n, (1n << 128n) - 1n]) {
		const f = fixture();
		bytes(f, "positionAccount", (b) => {
			b.writeBigUInt64LE(amount & ((1n << 64n) - 1n), 72);
			b.writeBigUInt64LE(amount >> 64n, 80);
		});
		assert.equal(
			projectPositionBaselineEvidence(f).liquidityRaw,
			amount.toString(),
		);
	}
});

function rpcFixture() {
	const f = fixture();
	const accounts = [f.positionAccount, f.mintAccount, f.tokenAccount];
	const response = {
		context: { slot: 15 },
		value: accounts.map((a) => ({
			owner: new PublicKey(a.owner),
			executable: a.executable,
			data: Buffer.from(a.dataBase64, "base64"),
		})),
	};
	const calls = [];
	const connection = {
		async getMultipleAccountsInfoAndContext(keys, config) {
			calls.push({ keys: keys.map((k) => k.toBase58()), config });
			return response;
		},
	};
	return {
		response,
		calls,
		configuration: {
			connection,
			network: f.network,
			programId: f.programId,
			layoutVersion: f.layoutVersion,
		},
		request: {
			positionAddress: f.positionAccount.address,
			positionMint: f.mintAccount.address,
			tokenAccountAddress: f.tokenAccount.address,
			minContextSlot: 12,
		},
	};
}
test("reader uses one finalized context for all three accounts and preserves actual returned slot", async () => {
	const f = rpcFixture();
	const result = await createPositionBaselineReader(f.configuration).read(
		f.request,
	);
	assert.equal(result.slot, 15);
	assert.equal(result.ownershipCoverage, "POINT_IN_TIME");
	assert.equal(f.calls.length, 1);
	assert.deepEqual(f.calls[0].config, {
		commitment: "finalized",
		minContextSlot: 12,
	});
	assert.deepEqual(f.calls[0].keys, [
		f.request.positionAddress,
		f.request.positionMint,
		f.request.tokenAccountAddress,
	]);
});
for (const [name, mutate, pattern] of [
	[
		"stale context",
		(f) => {
			f.response.context.slot = 11;
		},
		/stale/,
	],
	[
		"missing context",
		(f) => {
			delete f.response.context;
		},
		/snapshot/,
	],
	[
		"missing account",
		(f) => {
			f.response.value[1] = null;
		},
		/missing/,
	],
	[
		"short result",
		(f) => {
			f.response.value.pop();
		},
		/incomplete/,
	],
	[
		"parsed data",
		(f) => {
			f.response.value[1].data = { parsed: {} };
		},
		/raw account/,
	],
	[
		"malformed account owner",
		(f) => {
			f.response.value[0].owner = new PublicKey(wallet);
		},
		/owner/,
	],
])
	test(`reader refuses ${name}`, async () => {
		const f = rpcFixture();
		mutate(f);
		await assert.rejects(
			createPositionBaselineReader(f.configuration).read(f.request),
			pattern,
		);
	});
test("reader rejects invalid configuration/request before any RPC and propagates transport failure", async () => {
	const f = rpcFixture();
	assert.throws(
		() =>
			createPositionBaselineReader({ ...f.configuration, network: "MAINNET" }),
		/configuration/,
	);
	const reader = createPositionBaselineReader(f.configuration);
	await assert.rejects(
		reader.read({ ...f.request, minContextSlot: -1 }),
		/context slot/,
	);
	await assert.rejects(
		reader.read({ ...f.request, tokenAccountAddress: f.request.positionMint }),
		/repeated/,
	);
	assert.equal(f.calls.length, 0);
	f.configuration.connection.getMultipleAccountsInfoAndContext = async () => {
		throw new Error("fixture transport error");
	};
	await assert.rejects(reader.read(f.request), /transport error/);
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
		"unknown layout",
		(f) => {
			f.layoutVersion = "future";
		},
		/pinned/,
	],
	[
		"unsafe slot",
		(f) => {
			f.slot = Number.MAX_SAFE_INTEGER + 1;
		},
		/pinned/,
	],
	[
		"different program owner",
		(f) => {
			f.positionAccount.owner = wallet;
		},
		/owner/,
	],
	[
		"executable account",
		(f) => {
			f.tokenAccount.executable = true;
		},
		/executable/,
	],
	[
		"missing account",
		(f) => {
			delete f.mintAccount;
		},
		/address/,
	],
	[
		"wrong PDA",
		(f) => {
			f.positionAccount.address = wallet;
		},
		/PDA/,
	],
	[
		"wrong discriminator",
		(f) =>
			bytes(f, "positionAccount", (b) => {
				b[0] ^= 1;
			}),
		/discriminator/,
	],
	[
		"invalid ticks",
		(f) =>
			bytes(f, "positionAccount", (b) => {
				b.writeInt32LE(-100, 92);
			}),
		/ticks/,
	],
	[
		"wrong mint address",
		(f) => {
			f.mintAccount.address = wallet;
		},
		/mint differs/,
	],
	[
		"wrong token mint",
		(f) =>
			bytes(f, "tokenAccount", (b) => {
				b.fill(0, 0, 32);
			}),
		/mint differs/,
	],
	[
		"Token2022 mint",
		(f) => {
			f.mintAccount.owner = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
		},
		/owner/,
	],
	[
		"uninitialized mint",
		(f) =>
			bytes(f, "mintAccount", (b) => {
				b[45] = 0;
			}),
		/NFT mint/,
	],
	[
		"fungible decimals",
		(f) =>
			bytes(f, "mintAccount", (b) => {
				b[44] = 9;
			}),
		/NFT mint/,
	],
	[
		"multiple NFT supply",
		(f) =>
			bytes(f, "mintAccount", (b) => {
				b.writeBigUInt64LE(2n, 36);
			}),
		/NFT mint/,
	],
	[
		"malformed mint authority option",
		(f) =>
			bytes(f, "mintAccount", (b) => {
				b.writeUInt32LE(2, 0);
			}),
		/NFT mint/,
	],
	[
		"empty token balance",
		(f) =>
			bytes(f, "tokenAccount", (b) => {
				b.writeBigUInt64LE(0n, 64);
			}),
		/ownership/,
	],
	[
		"frozen NFT",
		(f) =>
			bytes(f, "tokenAccount", (b) => {
				b[108] = 2;
			}),
		/ownership/,
	],
	[
		"delegated NFT",
		(f) =>
			bytes(f, "tokenAccount", (b) => {
				b.writeUInt32LE(1, 72);
			}),
		/ownership/,
	],
	[
		"delegated amount",
		(f) =>
			bytes(f, "tokenAccount", (b) => {
				b.writeBigUInt64LE(1n, 121);
			}),
		/ownership/,
	],
	[
		"native option",
		(f) =>
			bytes(f, "tokenAccount", (b) => {
				b.writeUInt32LE(1, 109);
			}),
		/ownership/,
	],
	[
		"close authority",
		(f) =>
			bytes(f, "tokenAccount", (b) => {
				b.writeUInt32LE(1, 129);
			}),
		/ownership/,
	],
	[
		"noncanonical base64",
		(f) => {
			f.positionAccount.dataBase64 += "\n";
		},
		/base64/,
	],
	[
		"extended position",
		(f) => {
			f.positionAccount.dataBase64 = Buffer.alloc(217).toString("base64");
		},
		/size/,
	],
	[
		"extended token",
		(f) => {
			f.tokenAccount.dataBase64 = Buffer.alloc(166).toString("base64");
		},
		/size/,
	],
])
	test(`baseline refuses ${name}`, () => {
		const f = fixture();
		mutate(f);
		assert.throws(() => projectPositionBaselineEvidence(f), pattern);
	});
