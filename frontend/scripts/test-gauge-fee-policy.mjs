import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
	GAUGED_PROTOCOL_FEE_RATE, UNGAUGED_PROTOCOL_FEE_RATE,
	gaugeAddressForPool, planGaugeFeePolicy, readLpIncentiveRates, reconcileGaugeFeePolicy,
} from "./lib/gauge-fee-policy.mjs";

const address = (byte) => new PublicKey(Buffer.alloc(32, byte));
const programId = address(1), protocol = address(2), dexConfig = address(3);
const wallet = { publicKey: address(4) };
function pool(byte, rate, config = dexConfig) {
	return { publicKey: address(byte), account: {
		solvesConfig: config, protocolFeeRate: rate,
		tokenMintA: address(30), tokenMintB: address(31),
		protocolFeeOwedA: "92000000", protocolFeeOwedB: "2224000",
		rewardInfos: [0, 1, 2].map(index => ({ authority: new PublicKey(Uint8Array.from({length:32}, (_, i) => index === 1 && i === 0 ? 2 : 0)) })),
	} };
}
function gauge(forPool, isActive = true, forProtocol = protocol) {
	return {
		publicKey: gaugeAddressForPool(programId, forProtocol, forPool.publicKey),
		account: { poolAddress: forPool.publicKey, tokenMintA: forPool.account.tokenMintA,
			tokenMintB: forPool.account.tokenMintB, isActive },
	};
}
function fixture() {
	const pools = [pool(10, 8_000), pool(11, 0), pool(12, 0), pool(13, 4_000, address(9))];
	return {
		programId, protocol, dexConfig,
		config: { feeAuthority: wallet.publicKey, defaultProtocolFeeRate: 8_000 },
		pools, gauges: [gauge(pools[1]), gauge(pools[2], false), gauge(pools[3])],
	};
}
function mock(snapshot = fixture(), options = {}) {
	const sent = [], built = [], instructionActions = new WeakMap();
	const method = (name, rate) => ({ accounts: (accounts) => ({ instruction: async () => {
		const instruction = new TransactionInstruction({ keys: [], programId, data: Buffer.alloc(0) });
		const action = { name, rate, accounts };
		instructionActions.set(instruction, action); built.push(action); return instruction;
	} }) });
	const program = { programId, account: { gauge: {
		all: async () => { if (options.failGaugeList) throw new Error("gauge RPC unavailable"); return snapshot.gauges; },
		fetchNullable: async (key) => {
			if (options.failGaugeRefresh) throw new Error("gauge refresh unavailable");
			if (options.beforeGaugeRefresh) options.beforeGaugeRefresh(snapshot);
			return snapshot.gauges.find((item) => item.publicKey.equals(key))?.account ?? null;
		},
	} } };
	const dexContext = { program: { account: {
		solvesConfig: { fetch: async () => ({ ...snapshot.config }) },
		solve: {
			all: async () => { if (options.failPoolList) throw new Error("pool RPC unavailable"); return snapshot.pools; },
			fetch: async (key) => ({ ...snapshot.pools.find((item) => item.publicKey.equals(key)).account }),
		},
	}, methods: {
		setDefaultProtocolFeeRate: (rate) => method("default", rate),
		setProtocolFeeRate: (rate) => method("pool", rate),
	} } };
	const provider = { sendAndConfirm: async (transaction) => {
		assert.equal(transaction.instructions.length, 1);
		const action = instructionActions.get(transaction.instructions[0]);
		sent.push(action);
		if (!options.ignoreWrite) {
			if (action.name === "default") snapshot.config.defaultProtocolFeeRate = action.rate;
			else snapshot.pools.find((item) => item.publicKey.equals(action.accounts.solve)).account.protocolFeeRate = action.rate;
		}
		if (options.afterWrite) options.afterWrite(snapshot, action);
		return `test-signature-${sent.length}`;
	} };
	return { args: { program, dexContext, provider, dexConfig, protocol, wallet }, sent, built, snapshot };
}

assert.equal(UNGAUGED_PROTOCOL_FEE_RATE, 0);
assert.equal(GAUGED_PROTOCOL_FEE_RATE, 10_000);
{
	const snapshot = fixture();
	const plan = planGaugeFeePolicy(snapshot);
	assert.equal(plan.defaultPolicy.to, 0);
	assert.equal(plan.poolPolicies.length, 3, "Other DEX configs must not be changed");
	assert.equal(plan.poolPolicies.find((item) => item.pool === address(10).toBase58()).to, 0);
	assert.equal(plan.poolPolicies.find((item) => item.pool === address(11).toBase58()).to, 10_000);
	assert.equal(plan.poolPolicies.find((item) => item.pool === address(12).toBase58()).to, 0, "Inactive gauge returns all new fees to LPs");
	assert.equal(plan.gauges.length, 2);
	snapshot.gauges.push(gauge(snapshot.pools[0], true, address(99)));
	assert.equal(planGaugeFeePolicy(snapshot).poolPolicies.find((item) => item.pool === address(10).toBase58()).to, 0,
		"Foreign protocol gauge cannot change this protocol's policy");
}
{
	// Soft-launch LP incentive: an enrolled ungauged pool keeps its fee share;
	// an active gauge still wins; unknown pools are unaffected.
	const snapshot = fixture();
	const incentiveRates = new Map([[address(10).toBase58(), 3000], [address(11).toBase58(), 3000]]);
	const plan = planGaugeFeePolicy({ ...snapshot, incentiveRates });
	assert.equal(plan.poolPolicies.find((item) => item.pool === address(10).toBase58()).to, 3000, "Incentivized ungauged pool keeps its fee share");
	assert.equal(plan.poolPolicies.find((item) => item.pool === address(10).toBase58()).lpIncentive, true);
	assert.equal(plan.poolPolicies.find((item) => item.pool === address(11).toBase58()).to, 10_000, "Active gauge overrides the incentive");
	assert.equal(plan.poolPolicies.find((item) => item.pool === address(12).toBase58()).to, 0);
	assert.equal(readLpIncentiveRates("/nonexistent/lp-incentives.json").size, 0, "Missing config means no overrides");
}
{
	const state = fixture(); state.gauges.push(state.gauges[0]);
	assert.throws(() => planGaugeFeePolicy(state), /Duplicate gauge/);
	const duplicatePools = fixture(); duplicatePools.pools.push(duplicatePools.pools[0]);
	assert.throws(() => planGaugeFeePolicy(duplicatePools), /Duplicate pool/);
	const missingPool = fixture(); missingPool.gauges.push(gauge(pool(77, 0)));
	assert.throws(() => planGaugeFeePolicy(missingPool), /undiscovered DEX pool/);
	const mismatch = fixture(); mismatch.gauges[0].account.tokenMintA = address(99);
	assert.throws(() => planGaugeFeePolicy(mismatch), /token mints do not match/);
	const badRate = fixture(); badRate.pools[0].account.protocolFeeRate = NaN;
	assert.throws(() => planGaugeFeePolicy(badRate), /Invalid/);
	assert.throws(() => planGaugeFeePolicy({ ...fixture(), gauges: null }), /Complete/);
}
{
	const state = mock();
	const result = await reconcileGaugeFeePolicy({ ...state.args, dryRun: true });
	assert.equal(result.plan.changes.length, 2);
	assert.equal(state.built.length, 0, "Dry-run must not even build a write");
	assert.equal(state.sent.length, 0);
	assert.equal(state.snapshot.config.defaultProtocolFeeRate, 8_000);
}
{
	const state = mock();
	const beforeCounters = state.snapshot.pools.map((item) => [item.account.protocolFeeOwedA, item.account.protocolFeeOwedB]);
	const first = await reconcileGaugeFeePolicy({ ...state.args, dryRun: false });
	assert.equal(first.signatures.length, 3);
	assert.deepEqual(state.sent.map((item) => item.name).sort(), ["default", "pool", "pool"]);
	assert.deepEqual(state.snapshot.pools.map((item) => [item.account.protocolFeeOwedA, item.account.protocolFeeOwedB]), beforeCounters,
		"Policy reconciliation must leave accrued fee counters untouched");
	assert.equal(state.snapshot.pools[3].account.protocolFeeRate, 4_000);
	const second = await reconcileGaugeFeePolicy({ ...state.args, dryRun: false });
	assert.equal(second.signatures.length, 0, "Repeated reconciliation must be idempotent");
	assert.equal(state.sent.length, 3);
}
{
	const state = mock(); delete state.snapshot.pools[1].account.rewardInfos;
	await assert.rejects(reconcileGaugeFeePolicy({ ...state.args, dryRun: false }), /Native gauge migration required/);
	assert.equal(state.sent.length, 0, "No policy writes before native reward migration");
}
for (const failure of ["failGaugeList", "failPoolList"]) {
	const state = mock(fixture(), { [failure]: true });
	await assert.rejects(reconcileGaugeFeePolicy({ ...state.args, dryRun: false }), /RPC unavailable/);
	assert.equal(state.sent.length, 0, "Discovery failures must abort before any mutation");
}
{
	const state = mock();
	await assert.rejects(reconcileGaugeFeePolicy({ ...state.args, wallet: { publicKey: address(90) }, dryRun: false }), /not DEX fee authority/);
	assert.equal(state.sent.length, 0);
}
{
	const snapshot = fixture(); snapshot.config.defaultProtocolFeeRate = 0;
	snapshot.pools = [snapshot.pools[0]]; snapshot.gauges = [];
	const state = mock(snapshot, { beforeGaugeRefresh: (latest) => {
		latest.gauges = [gauge(latest.pools[0])];
		latest.pools[0].account.protocolFeeRate = 10_000;
	} });
	await reconcileGaugeFeePolicy({ ...state.args, dryRun: false });
	assert.ok(state.sent.every((item) => item.rate === 10_000), "Fresh gauge detection must not undo a concurrent gauge+fee creation");
}
{
	const snapshot = fixture(); snapshot.config.defaultProtocolFeeRate = 0;
	snapshot.pools = [snapshot.pools[0]]; snapshot.gauges = [];
	const state = mock(snapshot, { afterWrite: (latest, action) => {
		if (action.rate === 0) latest.gauges = [gauge(latest.pools[0])];
	} });
	const result = await reconcileGaugeFeePolicy({ ...state.args, dryRun: false });
	assert.deepEqual(state.sent.map((item) => item.rate), [0, 10_000]);
	assert.equal(result.signatures[1].action, "gauge_creation_race_repaired");
	assert.equal(snapshot.pools[0].account.protocolFeeRate, 10_000,
		"Gauge creation during an ungauged write must be repaired before success");
}
{
	const snapshot = fixture(); snapshot.config.defaultProtocolFeeRate = 0;
	const state = mock(snapshot, { failGaugeRefresh: true });
	await assert.rejects(reconcileGaugeFeePolicy({ ...state.args, dryRun: false }), /gauge refresh unavailable/);
	assert.equal(state.sent.length, 0, "Failed existence re-check must not set an ungauged rate");
}
{
	const state = mock(fixture(), { ignoreWrite: true });
	await assert.rejects(reconcileGaugeFeePolicy({ ...state.args, dryRun: false }), /Default protocol fee rate verification failed/);
	const snapshot = fixture(); snapshot.config.defaultProtocolFeeRate = 0;
	const poolState = mock(snapshot, { ignoreWrite: true });
	await assert.rejects(reconcileGaugeFeePolicy({ ...poolState.args, dryRun: false }), /Pool .* verification failed/);
}
const keeper = await readFile(new URL("./finalize-devnet-epoch.mjs", import.meta.url), "utf8");
const onlyMode = keeper.indexOf("if (feePolicyOnly)");
assert.ok(onlyMode > 0 && onlyMode < keeper.indexOf("await routePoolFees(initialEpoch)"));
assert.ok(onlyMode < keeper.indexOf(".updateEpoch()"));
assert.ok(keeper.slice(onlyMode, keeper.indexOf("const gauges =", onlyMode)).includes("process.exit(0)"));
assert.ok(keeper.indexOf("genesisHash !== DEVNET_GENESIS_HASH") < keeper.indexOf("await reconcileGaugeFeePolicy("));
console.log("PASS: gauge fee policy 0/10000, inactive gauges, config/protocol scope, duplicates, dry-run, idempotence, RPC/authority/verification failures, creation race re-check, untouched accrued fees, and fee-only early exit.");
