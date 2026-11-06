import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
	CANDIDATE_ACCOUNTS,
	collectDevnetInventory,
	DEVNET_GENESIS_HASH,
} from "./devnet-inventory.mjs";

const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const programDataAddresses = new Map(
	[CANDIDATE_ACCOUNTS.dexProgram, CANDIDATE_ACCOUNTS.veProgram].map(
		(address) => [
			address,
			PublicKey.findProgramAddressSync(
				[new PublicKey(address).toBuffer()],
				loader,
			)[0].toBase58(),
		],
	),
);

function fakeProgram(address) {
	const data = Buffer.alloc(36);
	data.writeUInt32LE(2, 0);
	new PublicKey(programDataAddresses.get(address)).toBuffer().copy(data, 4);
	return {
		executable: true,
		owner: loader.toBase58(),
		lamports: 1,
		data: [data.toString("base64"), "base64"],
	};
}

function fakeProgramData() {
	const data = Buffer.alloc(48);
	data.writeUInt32LE(3, 0);
	data.writeBigUInt64LE(99n, 4);
	data[12] = 1;
	new PublicKey(CANDIDATE_ACCOUNTS.solv3Mint).toBuffer().copy(data, 13);
	data.write("ELF", 45);
	return {
		executable: false,
		owner: loader.toBase58(),
		lamports: 1,
		data: [data.toString("base64"), "base64"],
	};
}

function fakeRpc(genesisHash = DEVNET_GENESIS_HASH) {
	const calls = [];
	const fetcher = async (_url, options) => {
		const request = JSON.parse(options.body);
		calls.push(request.method);
		let result;
		if (request.method === "getGenesisHash") result = genesisHash;
		if (request.method === "getSlot") result = 123;
		if (request.method === "getAccountInfo") {
			const address = request.params[0];
			let value;
			if (address === CANDIDATE_ACCOUNTS.solv3Mint) {
				value = {
					executable: false,
					owner: "TokenProgram",
					lamports: 1,
					data: {
						parsed: {
							type: "mint",
							info: {
								decimals: 9,
								mintAuthority: "Authority",
								freezeAuthority: null,
								supply: "1",
							},
						},
					},
				};
			} else if (programDataAddresses.has(address)) {
				value = fakeProgram(address);
			} else if ([...programDataAddresses.values()].includes(address)) {
				value = fakeProgramData();
			}
			result = {
				context: { slot: 123 },
				value,
			};
		}
		return { ok: true, json: async () => ({ result }) };
	};
	return { fetcher, calls };
}

test("collects only finalized Devnet candidate evidence", async () => {
	const { fetcher, calls } = fakeRpc();
	const inventory = await collectDevnetInventory(
		"https://rpc.example.test",
		fetcher,
	);
	assert.equal(inventory.status, "UNREVIEWED_CANDIDATE_INVENTORY");
	assert.equal(inventory.finalizedSlot, 123);
	assert.equal(inventory.accounts.solv3Mint.mint.decimals, 9);
	assert.match(
		inventory.accounts.dexProgram.accountDataSha256,
		/^[0-9a-f]{64}$/,
	);
	assert.equal(
		inventory.accounts.dexProgram.programData.lastDeployedSlot,
		"99",
	);
	assert.equal(
		inventory.accounts.dexProgram.programData.upgradeAuthority,
		CANDIDATE_ACCOUNTS.solv3Mint,
	);
	assert.match(
		inventory.accounts.dexProgram.programData.allocatedExecutableDataSha256,
		/^[0-9a-f]{64}$/,
	);
	assert.deepEqual(calls, [
		"getGenesisHash",
		"getSlot",
		"getAccountInfo",
		"getAccountInfo",
		"getAccountInfo",
		"getAccountInfo",
		"getAccountInfo",
	]);
});

test("refuses wrong network before account reads", async () => {
	const { fetcher, calls } = fakeRpc("mainnet-hash");
	await assert.rejects(
		collectDevnetInventory("https://rpc.example.test", fetcher),
		/non-Devnet/,
	);
	assert.deepEqual(calls, ["getGenesisHash"]);
});

test("refuses non-TLS RPC URLs", async () => {
	await assert.rejects(
		collectDevnetInventory("http://rpc.example.test"),
		/HTTPS/,
	);
});

test("records missing candidate programs without claiming deployment", async () => {
	const { fetcher } = fakeRpc();
	const badFetcher = async (url, options) => {
		const response = await fetcher(url, options);
		if (
			JSON.parse(options.body).params?.[0] === CANDIDATE_ACCOUNTS.dexProgram
		) {
			return {
				ok: true,
				json: async () => ({ result: { context: { slot: 123 }, value: null } }),
			};
		}
		return response;
	};
	const inventory = await collectDevnetInventory(
		"https://rpc.example.test",
		badFetcher,
	);
	assert.equal(inventory.accounts.dexProgram.exists, false);
});

test("rejects non-executable program and stale account context", async () => {
	const { fetcher } = fakeRpc();
	const badProgram = async (url, options) => {
		const response = await fetcher(url, options);
		if (
			JSON.parse(options.body).params?.[0] === CANDIDATE_ACCOUNTS.dexProgram
		) {
			return {
				ok: true,
				json: async () => ({
					result: {
						context: { slot: 123 },
						value: {
							executable: false,
							owner: "BPFLoader",
							data: ["", "base64"],
						},
					},
				}),
			};
		}
		return response;
	};
	await assert.rejects(
		collectDevnetInventory("https://rpc.example.test", badProgram),
		/executable dexProgram/,
	);
	const staleContext = async (url, options) => {
		const response = await fetcher(url, options);
		if (
			JSON.parse(options.body).params?.[0] === CANDIDATE_ACCOUNTS.dexProgram
		) {
			return {
				ok: true,
				json: async () => ({ result: { context: { slot: 122 }, value: null } }),
			};
		}
		return response;
	};
	await assert.rejects(
		collectDevnetInventory("https://rpc.example.test", staleContext),
		/invalid dexProgram/,
	);
});

test("rejects a malformed ProgramData authority tag", async () => {
	const { fetcher } = fakeRpc();
	const dexProgramDataAddress = programDataAddresses.get(
		CANDIDATE_ACCOUNTS.dexProgram,
	);
	const badFetcher = async (url, options) => {
		const response = await fetcher(url, options);
		if (JSON.parse(options.body).params?.[0] !== dexProgramDataAddress)
			return response;
		const body = await response.json();
		const bytes = Buffer.from(body.result.value.data[0], "base64");
		bytes[12] = 2;
		body.result.value.data[0] = bytes.toString("base64");
		return { ok: true, json: async () => body };
	};
	await assert.rejects(
		collectDevnetInventory("https://rpc.example.test", badFetcher),
		/invalid upgrade authority tag/,
	);
});

test("records a revoked upgrade authority as null", async () => {
	const { fetcher } = fakeRpc();
	const dexProgramDataAddress = programDataAddresses.get(
		CANDIDATE_ACCOUNTS.dexProgram,
	);
	const noAuthority = async (url, options) => {
		const response = await fetcher(url, options);
		if (JSON.parse(options.body).params?.[0] !== dexProgramDataAddress)
			return response;
		const body = await response.json();
		const bytes = Buffer.from(body.result.value.data[0], "base64");
		bytes[12] = 0;
		bytes.fill(0, 13, 45);
		body.result.value.data[0] = bytes.toString("base64");
		return { ok: true, json: async () => body };
	};
	const inventory = await collectDevnetInventory(
		"https://rpc.example.test",
		noAuthority,
	);
	assert.equal(
		inventory.accounts.dexProgram.programData.upgradeAuthority,
		null,
	);
});

test("rejects a Program account pointing outside its derived ProgramData PDA", async () => {
	const { fetcher } = fakeRpc();
	const wrongAddress = CANDIDATE_ACCOUNTS.solv3Mint;
	const wrongPointer = async (url, options) => {
		const request = JSON.parse(options.body);
		const response = await fetcher(url, options);
		if (request.params?.[0] === CANDIDATE_ACCOUNTS.dexProgram) {
			const body = await response.json();
			const bytes = Buffer.from(body.result.value.data[0], "base64");
			new PublicKey(wrongAddress).toBuffer().copy(bytes, 4);
			body.result.value.data[0] = bytes.toString("base64");
			return { ok: true, json: async () => body };
		}
		if (
			request.params?.[0] === wrongAddress &&
			request.params[1].encoding === "base64"
		) {
			return {
				ok: true,
				json: async () => ({
					result: { context: { slot: 123 }, value: fakeProgramData() },
				}),
			};
		}
		return response;
	};
	await assert.rejects(
		collectDevnetInventory("https://rpc.example.test", wrongPointer),
		/unexpected ProgramData address/,
	);
});
