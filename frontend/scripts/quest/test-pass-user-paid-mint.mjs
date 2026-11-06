import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AccountLayout,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	ExtensionType,
	MintLayout,
	TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
	buildUserPaidPassTransaction,
	derivePassMint,
	verifyUserPaidPass,
} from "./pass-user-paid-mint.mjs";

const seed = new Uint8Array(32).fill(7),
	wallet = Keypair.fromSeed(new Uint8Array(32).fill(8));
const origin = "https://quest.solve3.test";
function rpc(genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") {
	return {
		getGenesisHash: async () => genesis,
		getMinimumBalanceForRentExemption: async (n) => n * 1000,
		getLatestBlockhash: async () => ({
			blockhash: Keypair.fromSeed(
				new Uint8Array(32).fill(9),
			).publicKey.toBase58(),
			lastValidBlockHeight: 1000,
		}),
		getFeeForMessage: async () => ({ value: 10000 }),
		getMultipleAccountsInfo: async () => [null, null],
	};
}
test("stable domain-separated mint is unique per wallet and seed", () => {
	const a = derivePassMint(seed, wallet.publicKey.toBase58());
	assert.ok(
		a.publicKey.equals(
			derivePassMint(seed, wallet.publicKey.toBase58()).publicKey,
		),
	);
	assert.ok(
		!a.publicKey.equals(
			derivePassMint(seed, Keypair.generate().publicKey.toBase58()).publicKey,
		),
	);
	assert.ok(
		!a.publicKey.equals(
			derivePassMint(new Uint8Array(32).fill(6), wallet.publicKey.toBase58())
				.publicKey,
		),
	);
	assert.throws(() =>
		derivePassMint(new Uint8Array(31), wallet.publicKey.toBase58()),
	);
});
test("wallet pays all network and account costs; server signs only mint", async () => {
	const mint = derivePassMint(seed, wallet.publicKey.toBase58());
	const result = await buildUserPaidPassTransaction({
		connection: rpc(),
		wallet: wallet.publicKey.toBase58(),
		mint,
		origin,
	});
	const tx = Transaction.from(Buffer.from(result.transaction, "base64"));
	assert.ok(tx.feePayer.equals(wallet.publicKey));
	assert.equal(tx.instructions.length, 8);
	assert.ok(tx.instructions[0].programId.equals(SystemProgram.programId));
	assert.ok(tx.instructions[0].keys[0].pubkey.equals(wallet.publicKey));
	assert.ok(tx.instructions[5].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
	assert.ok(tx.instructions[5].keys[0].pubkey.equals(wallet.publicKey));
	for (const i of [1, 2, 3, 4, 6, 7])
		assert.ok(tx.instructions[i].programId.equals(TOKEN_2022_PROGRAM_ID));
	assert.equal(tx.instructions[1].data[0], 32); // InitializeNonTransferableMint
	assert.equal(tx.instructions[7].data[0], 6); // SetAuthority (revoke mint authority)
	assert.equal(tx.signatures.filter((s) => s.signature !== null).length, 1);
	assert.ok(
		tx.signatures.find((s) => s.publicKey.equals(mint.publicKey)).signature,
	);
	assert.equal(
		tx.signatures.find((s) => s.publicKey.equals(wallet.publicKey)).signature,
		null,
	);
	tx.partialSign(wallet);
	assert.ok(tx.verifySignatures());
	assert.equal(
		result.maxCostLamports,
		result.mintRentLamports +
			result.tokenAccountRentLamports +
			result.feeLamports,
	);
	assert.equal(result.awardEligible, false);
	assert.ok(
		!JSON.stringify(result).includes(Buffer.from(seed).toString("hex")),
	);
});
test("wrong network refuses preparation and verification", async () => {
	const mint = derivePassMint(seed, wallet.publicKey.toBase58());
	await assert.rejects(
		buildUserPaidPassTransaction({
			connection: rpc("mainnet"),
			wallet: wallet.publicKey.toBase58(),
			mint,
			origin,
		}),
	);
	await assert.rejects(
		verifyUserPaidPass({
			connection: rpc("mainnet"),
			wallet: wallet.publicKey.toBase58(),
			mint: mint.publicKey.toBase58(),
			origin,
		}),
	);
});
test("missing finalized accounts are not Minted and wrong token program refuses", async () => {
	const mint = derivePassMint(
		seed,
		wallet.publicKey.toBase58(),
	).publicKey.toBase58();
	assert.equal(
		await verifyUserPaidPass({
			connection: rpc(),
			wallet: wallet.publicKey.toBase58(),
			mint,
			origin,
		}),
		false,
	);
	const bad = {
		...rpc(),
		getMultipleAccountsInfo: async () => [
			{ owner: SystemProgram.programId },
			{ owner: TOKEN_2022_PROGRAM_ID },
		],
	};
	await assert.rejects(
		verifyUserPaidPass({
			connection: bad,
			wallet: wallet.publicKey.toBase58(),
			mint,
			origin,
		}),
	);
});

function chainFixture({
	supply = 1n,
	transferable = false,
	wrongOwner = false,
	authority = false,
} = {}) {
	const address = derivePassMint(seed, wallet.publicKey.toBase58()).publicKey;
	const tlv = (type, data = Buffer.alloc(0)) => {
		const h = Buffer.alloc(4);
		h.writeUInt16LE(type, 0);
		h.writeUInt16LE(data.length, 2);
		return Buffer.concat([h, data]);
	};
	const string = (value) => {
		const bytes = Buffer.from(value),
			h = Buffer.alloc(4);
		h.writeUInt32LE(bytes.length);
		return Buffer.concat([h, bytes]);
	};
	const metadata = Buffer.concat([
		address.toBuffer(),
		address.toBuffer(),
		string("Solve3 Devnet Pass"),
		string("S3PASS"),
		string(`${origin}/assets/pass/devnet-explorer.json`),
		Buffer.alloc(4),
	]);
	const mintBase = Buffer.alloc(166);
	mintBase[165] = 1;
	MintLayout.encode(
		{
			mintAuthorityOption: authority ? 1 : 0,
			mintAuthority: address,
			supply,
			decimals: 0,
			isInitialized: true,
			freezeAuthorityOption: 0,
			freezeAuthority: address,
		},
		mintBase,
	);
	const mintData = Buffer.concat([
		mintBase,
		...(transferable ? [] : [tlv(ExtensionType.NonTransferable)]),
		tlv(
			ExtensionType.MetadataPointer,
			Buffer.concat([Buffer.alloc(32), address.toBuffer()]),
		),
		tlv(ExtensionType.TokenMetadata, metadata),
	]);
	const accountBase = Buffer.alloc(166);
	accountBase[165] = 2;
	AccountLayout.encode(
		{
			mint: address,
			owner: wrongOwner ? address : wallet.publicKey,
			amount: 1n,
			delegateOption: 0,
			delegate: address,
			state: 1,
			isNativeOption: 0,
			isNative: 0n,
			delegatedAmount: 0n,
			closeAuthorityOption: 0,
			closeAuthority: address,
		},
		accountBase,
	);
	const accountData = Buffer.concat([
		accountBase,
		tlv(ExtensionType.ImmutableOwner),
		tlv(ExtensionType.NonTransferableAccount),
	]);
	const info = (data) => ({
		data,
		owner: TOKEN_2022_PROGRAM_ID,
		lamports: 10000000,
		executable: false,
		rentEpoch: 0,
	});
	return {
		...rpc(),
		getMultipleAccountsInfo: async () => [info(mintData), info(accountData)],
		getAccountInfo: async () => info(mintData),
	};
}
test("finalized supply-one non-transferable account and exact metadata verify", async () => {
	assert.equal(
		await verifyUserPaidPass({
			connection: chainFixture(),
			wallet: wallet.publicKey.toBase58(),
			mint: derivePassMint(
				seed,
				wallet.publicKey.toBase58(),
			).publicKey.toBase58(),
			origin,
		}),
		true,
	);
});
for (const options of [
	{ supply: 2n },
	{ transferable: true },
	{ wrongOwner: true },
	{ authority: true },
])
	test(`refuses invalid NFT evidence ${JSON.stringify(options, (_, v) => (typeof v === "bigint" ? String(v) : v))}`, async () => {
		await assert.rejects(
			verifyUserPaidPass({
				connection: chainFixture(options),
				wallet: wallet.publicKey.toBase58(),
				mint: derivePassMint(
					seed,
					wallet.publicKey.toBase58(),
				).publicKey.toBase58(),
				origin,
			}),
		);
	});
