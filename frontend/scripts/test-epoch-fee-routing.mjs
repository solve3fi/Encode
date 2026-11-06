import assert from "node:assert/strict";
import anchor from "@coral-xyz/anchor";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
	assertFeeRoutingEpoch, buildPoolFeeRoutingTransaction, buildNativePoolFeeRoutingTransaction, routeFeeBatchForEpoch,
} from "./finalize-devnet-epoch.mjs";
import idl from '../src/configs/vesolve.json' with { type: 'json' };
import { configureNativeGaugeAccounts } from '../src/lib/nativeGaugeAccounts.ts';

const address = (byte) => new PublicKey(Buffer.alloc(32, byte));
const wallet = { publicKey: Keypair.fromSeed(Buffer.alloc(32, 50)).publicKey };
const protocol = address(1), programId = address(2), dexProgramId = address(3);
const dexConfig = address(4), gaugeAddress = address(5), poolAddress = address(6);
const poolData = {
	tokenMintA: address(7), tokenMintB: address(8), tokenVaultA: address(9), tokenVaultB: address(10),
	protocolFeeOwedA: new anchor.BN(123), protocolFeeOwedB: new anchor.BN(456),
};
let collectAccounts, distributeAccounts, distributeAmounts;
const program = { programId, methods: { distributePoolReward: (...amounts) => ({ accounts: (accounts) => {
	distributeAmounts = amounts; distributeAccounts = accounts;
	return { instruction: async () => new TransactionInstruction({
		programId, keys: Object.values(accounts).map((pubkey) => ({ pubkey, isSigner: pubkey.equals(wallet.publicKey), isWritable: true })),
		data: Buffer.alloc(24),
	}) };
} }) } };
const dexContext = { program: { methods: { collectProtocolFees: () => ({ accounts: (accounts) => {
	collectAccounts = accounts;
	return { instruction: async () => new TransactionInstruction({
		programId: dexProgramId, keys: Object.values(accounts).map((pubkey) => ({ pubkey, isSigner: pubkey.equals(wallet.publicKey), isWritable: true })),
		data: Buffer.alloc(8),
	}) };
} }) } } };
const transaction = await buildPoolFeeRoutingTransaction({
	program, dexContext, dexConfig, protocol, wallet, gaugeAddress, poolAddress, poolData, epoch: 42,
});
assert.equal(transaction.instructions.length, 6, "All four ATAs, collect and deposit must be atomic");
const setup = transaction.instructions.slice(0, 4);
for (const instruction of setup) {
	assert.ok(instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
	assert.deepEqual([...instruction.data], [1], "ATA setup must be idempotent");
	assert.ok(instruction.keys[0].pubkey.equals(wallet.publicKey), "Keeper pays ATA rent");
	assert.ok(instruction.keys[5].pubkey.equals(TOKEN_PROGRAM_ID));
}
const expectedVault = PublicKey.findProgramAddressSync([
	Buffer.from("vault"), new anchor.BN(42).toArrayLike(Buffer, "le", 8), gaugeAddress.toBuffer(),
], programId)[0];
assert.ok(distributeAccounts.vault.equals(expectedVault));
assert.ok(setup[0].keys[2].pubkey.equals(wallet.publicKey));
assert.ok(setup[1].keys[2].pubkey.equals(wallet.publicKey));
assert.ok(setup[2].keys[2].pubkey.equals(expectedVault));
assert.ok(setup[3].keys[2].pubkey.equals(expectedVault));
assert.ok(setup[0].keys[1].pubkey.equals(collectAccounts.tokenDestinationA));
assert.ok(setup[1].keys[1].pubkey.equals(collectAccounts.tokenDestinationB));
assert.ok(setup[2].keys[1].pubkey.equals(distributeAccounts.vaultTokenAccountA));
assert.ok(setup[3].keys[1].pubkey.equals(distributeAccounts.vaultTokenAccountB));
assert.ok(distributeAccounts.userTokenAccountA.equals(getAssociatedTokenAddressSync(poolData.tokenMintA, wallet.publicKey)));
assert.ok(transaction.instructions[4].programId.equals(dexProgramId));
assert.ok(transaction.instructions[5].programId.equals(programId));
assert.deepEqual(distributeAmounts.map((amount) => amount.toString()), ["123", "456"]);
transaction.feePayer = wallet.publicKey; transaction.recentBlockhash = address(90).toBase58();
assert.ok(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232,
	"Legacy transaction with four ATA instructions must fit the Solana packet limit");

const gauges = ["first", "second", "third"].map((symbol) => ({ symbol }));
// Use the real released IDL, not mocked account metas, for the current path.
const realProgram = new anchor.Program(idl, { publicKey: wallet.publicKey });
const nativeTx = await buildNativePoolFeeRoutingTransaction({ program: realProgram, dexProgramId,
 dexConfig, protocol, wallet, gaugeAddress, poolAddress, poolData, epoch: 42 });
assert.equal(nativeTx.instructions.length, 2, 'Compute budget plus direct, atomic fee routing');
const decoded = realProgram.coder.instruction.decode(nativeTx.instructions[1].data);
assert.equal(decoded.name, 'routePoolFees');
assert.equal(decoded.data.expectedEpoch.toString(), '42');
assert.equal(nativeTx.instructions[1].data.length, 16, 'No stale off-chain fee amounts are encoded');
nativeTx.add(await realProgram.methods.configureNativeGauge(false).accounts(configureNativeGaugeAccounts({
 admin: wallet.publicKey, protocol, gauge: gaugeAddress, pool: poolAddress, solvesConfig: dexConfig,
 tokenMintA: poolData.tokenMintA, tokenMintB: poolData.tokenMintB,
 rewardMint: address(11), programId: realProgram.programId, dexProgramId,
})).instruction());
nativeTx.feePayer = wallet.publicKey; nativeTx.recentBlockhash = address(90).toBase58();
assert.ok(nativeTx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232,
 'Combined sweep and gauge pause must fit a single atomic Solana transaction');
const state = (epoch) => ({ currentEpoch: new anchor.BN(epoch) });
await assertFeeRoutingEpoch(async () => state(42), 42);
await assert.rejects(assertFeeRoutingEpoch(async () => state(43), 42), /refusing to reassign/);
{
	const routed = [];
	const after = await routeFeeBatchForEpoch({
		gauges, epoch: 42, fetchProtocol: async () => state(42), log: () => {},
		routeGauge: async (item, epoch) => routed.push([item.symbol, epoch]),
	});
	assert.equal(after.currentEpoch.toNumber(), 42);
	assert.deepEqual(routed, [["first", 42], ["second", 42], ["third", 42]]);
}
{
	const routed = [], logs = [];
	await assert.rejects(routeFeeBatchForEpoch({
		gauges, epoch: 42, fetchProtocol: async () => state(42), log: (action, details) => logs.push({ action, details }),
		routeGauge: async (item) => { routed.push(item.symbol); if (item.symbol === "first") throw new Error("missing ATA"); },
	}), (error) => error instanceof AggregateError && /rollover blocked/.test(error.message) && error.errors[0].message === "missing ATA");
	assert.deepEqual(routed, ["first", "second", "third"], "One failed pool must not starve other pools of their sweep");
	assert.equal(logs.filter((item) => item.action === "epoch_rollover_blocked").length, 1);
}
{
	let epoch = 42; const routed = [];
	await assert.rejects(routeFeeBatchForEpoch({
		gauges, epoch: 42, fetchProtocol: async () => state(epoch), log: () => {},
		routeGauge: async (item) => { routed.push(item.symbol); epoch = 43; },
	}), /epoch changed from 42 to 43/);
	assert.deepEqual(routed, ["first"], "Never retry the remainder against another epoch");
}
{
	let calls = 0;
	await assert.rejects(routeFeeBatchForEpoch({
		gauges, epoch: 42, fetchProtocol: async () => state(43), log: () => {}, routeGauge: async () => { calls++; },
	}), /epoch changed/);
	assert.equal(calls, 0);
	await assert.rejects(routeFeeBatchForEpoch({
		gauges, epoch: 42, fetchProtocol: async () => { throw new Error("RPC unavailable"); }, log: () => {}, routeGauge: async () => { calls++; },
	}), /RPC unavailable/);
	assert.equal(calls, 0);
}
console.log("PASS: atomic idempotent keeper/gauge ATAs, correct epoch/mint routing, packet limit, healthy-pool progress, failed-sweep rollover block, stale/racing epoch rejection and fail-closed RPC handling.");
