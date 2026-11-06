import fs from "node:fs";
import crypto from "node:crypto";
import { Wallet } from "@coral-xyz/anchor";
import svmUtilities from "@solve3fi/common";
import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
} from "@solana/web3.js";
import {
	TOKEN_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import Decimal from "decimal.js";
import BN from "bn.js";
import {
	buildSolveClient,
	SolveContext,
	TickUtil,
	TokenExtensionUtil,
	increaseLiquidityQuoteByInputTokenUsingPriceSlippage,
	swapQuoteByInputToken,
	SolveIx,
	PDAUtil,
} from "@solve3fi/sdk";
import anchor from "@coral-xyz/anchor";
import idl from "../src/configs/vesolve.json" with { type: "json" };

const { Percentage } = svmUtilities;

const RPC = "https://devnet.helius-rpc.com/?api-key=REDACTED";
const DEX_PROGRAM_ID = new PublicKey("Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb");
const VESOLVE_PROGRAM_ID = new PublicKey("HUk7bMPwzxgJyrjrTsLZjZVuLj5YDbm3bgfL9MA1r3us");
const WIF3_GAUGE = new PublicKey("6Hqa6TYH4U12MAbktXDMbwAxcjpm7AQQsFrrkviGsSvB");
const KEYPAIR_PATH = "D:/Projects/ve33-contracts/id.json";

const keypair = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"))),
);
const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(keypair);
const dexCtx = SolveContext.from(connection, wallet, DEX_PROGRAM_ID);
const dexClient = buildSolveClient(dexCtx);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
const vesolveProgram = new anchor.Program(idl, provider);

const log = (label, obj) => console.log(`\n=== ${label} ===`, obj ?? "");

const disc = (name) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const pdaVe = (seeds) => PublicKey.findProgramAddressSync(seeds, VESOLVE_PROGRAM_ID)[0];
const s = (str) => Buffer.from(str);

const PROTOCOL = pdaVe([s("protocol")]);
const gaugeRewardPda = (gauge) => pdaVe([s("gauge_reward"), gauge.toBuffer()]);
const gaugeStakePda = (positionMint) => pdaVe([s("gauge_stake"), positionMint.toBuffer()]);

function readU128LE(buf, offset) {
	const lo = buf.readBigUInt64LE(offset);
	const hi = buf.readBigUInt64LE(offset + 8);
	return (hi << 64n) | lo;
}

async function decodeGaugeReward(address) {
	const info = await connection.getAccountInfo(address, "confirmed");
	if (!info) return null;
	const b = info.data;
	return {
		gauge: new PublicKey(b.subarray(8, 40)),
		rewardMint: new PublicKey(b.subarray(40, 72)),
		totalWeight: readU128LE(b, 72),
		rewardRateX64: readU128LE(b, 88),
		rewardPerWeightX64: readU128LE(b, 104),
		lastUpdateTime: b.readBigInt64LE(120),
		periodFinish: b.readBigInt64LE(128),
		lastFundedEpoch: b.readBigUInt64LE(136),
		bump: b.readUInt8(144),
	};
}

async function decodeGaugeStake(address) {
	const info = await connection.getAccountInfo(address, "confirmed");
	if (!info) return null;
	const b = info.data;
	return {
		owner: new PublicKey(b.subarray(8, 40)),
		gauge: new PublicKey(b.subarray(40, 72)),
		position: new PublicKey(b.subarray(72, 104)),
		positionMint: new PublicKey(b.subarray(104, 136)),
		liquidity: readU128LE(b, 136),
		weight: readU128LE(b, 152),
		rewardPerWeightPaidX64: readU128LE(b, 168),
		accruedRewards: b.readBigUInt64LE(184),
		lastFeeOwedA: b.readBigUInt64LE(192),
		lastFeeOwedB: b.readBigUInt64LE(200),
		isPaused: b.readUInt8(208) === 1,
		stakedAt: b.readBigInt64LE(209),
		bump: b.readUInt8(217),
	};
}

async function sendIx(instructions, label, extraSigners = []) {
	const tx = new Transaction();
	tx.add(...instructions);
	tx.feePayer = keypair.publicKey;
	tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
	tx.sign(keypair, ...extraSigners);
	const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
	await connection.confirmTransaction(signature, "confirmed");
	console.log(`${label}: ${signature}`);
	return signature;
}

async function buildAndExecute(txBuilder, label) {
	const signature = await txBuilder.buildAndExecute({ blockhashCommitment: "confirmed" });
	await connection.confirmTransaction(signature, "confirmed");
	console.log(`${label}: ${signature}`);
	return signature;
}

// ---- vesolve instruction builders (manual: the shipped IDL predates the
// pool/position accounts added to these instructions earlier this session,
// so anchor's account-name resolution can't be trusted for them) ----

function stakePositionIx({ owner, gauge, pool, gaugeReward, position, positionMint, stake, ownerPositionToken, custodyPositionToken }) {
	const keys = [
		{ pubkey: owner, isSigner: true, isWritable: true },
		{ pubkey: PROTOCOL, isSigner: false, isWritable: false },
		{ pubkey: gauge, isSigner: false, isWritable: false },
		{ pubkey: pool, isSigner: false, isWritable: false },
		{ pubkey: gaugeReward, isSigner: false, isWritable: true },
		{ pubkey: position, isSigner: false, isWritable: false },
		{ pubkey: positionMint, isSigner: false, isWritable: false },
		{ pubkey: stake, isSigner: false, isWritable: true },
		{ pubkey: ownerPositionToken, isSigner: false, isWritable: true },
		{ pubkey: custodyPositionToken, isSigner: false, isWritable: true },
		{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		{ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
	];
	return new TransactionInstruction({ programId: VESOLVE_PROGRAM_ID, keys, data: disc("stake_position") });
}

function syncStakeIx({ caller, gauge, pool, position, gaugeReward, stake }) {
	const keys = [
		{ pubkey: caller, isSigner: true, isWritable: false },
		{ pubkey: gauge, isSigner: false, isWritable: false },
		{ pubkey: pool, isSigner: false, isWritable: false },
		{ pubkey: position, isSigner: false, isWritable: false },
		{ pubkey: gaugeReward, isSigner: false, isWritable: true },
		{ pubkey: stake, isSigner: false, isWritable: true },
	];
	return new TransactionInstruction({ programId: VESOLVE_PROGRAM_ID, keys, data: disc("sync_stake") });
}

function claimGaugeRewardsIx({ owner, gauge, pool, position, gaugeReward, stake, rewardMint, rewardVault, ownerRewardToken }) {
	const keys = [
		{ pubkey: owner, isSigner: true, isWritable: true },
		{ pubkey: PROTOCOL, isSigner: false, isWritable: false },
		{ pubkey: gauge, isSigner: false, isWritable: false },
		{ pubkey: pool, isSigner: false, isWritable: false },
		{ pubkey: position, isSigner: false, isWritable: false },
		{ pubkey: gaugeReward, isSigner: false, isWritable: true },
		{ pubkey: stake, isSigner: false, isWritable: true },
		{ pubkey: rewardMint, isSigner: false, isWritable: false },
		{ pubkey: rewardVault, isSigner: false, isWritable: true },
		{ pubkey: ownerRewardToken, isSigner: false, isWritable: true },
		{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		{ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
	];
	return new TransactionInstruction({ programId: VESOLVE_PROGRAM_ID, keys, data: disc("claim_gauge_rewards") });
}

function unstakePositionIx({ owner, gauge, pool, position, gaugeReward, stake, positionMint, custodyPositionToken, ownerPositionToken, rewardMint, rewardVault, ownerRewardToken }) {
	const keys = [
		{ pubkey: owner, isSigner: true, isWritable: true },
		{ pubkey: PROTOCOL, isSigner: false, isWritable: false },
		{ pubkey: gauge, isSigner: false, isWritable: false },
		{ pubkey: pool, isSigner: false, isWritable: false },
		{ pubkey: position, isSigner: false, isWritable: false },
		{ pubkey: gaugeReward, isSigner: false, isWritable: true },
		{ pubkey: stake, isSigner: false, isWritable: true },
		{ pubkey: positionMint, isSigner: false, isWritable: false },
		{ pubkey: custodyPositionToken, isSigner: false, isWritable: true },
		{ pubkey: ownerPositionToken, isSigner: false, isWritable: true },
		{ pubkey: rewardMint, isSigner: false, isWritable: false },
		{ pubkey: rewardVault, isSigner: false, isWritable: true },
		{ pubkey: ownerRewardToken, isSigner: false, isWritable: true },
		{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		{ pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
		{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
	];
	return new TransactionInstruction({ programId: VESOLVE_PROGRAM_ID, keys, data: disc("unstake_position") });
}

// ---- main ----

const gaugeState = await vesolveProgram.account.gauge.fetchNullable(WIF3_GAUGE);
if (!gaugeState) throw new Error("WIF3 gauge not found");
const poolAddress = gaugeState.poolAddress;
log("gauge", { pool: poolAddress.toBase58(), isActive: gaugeState.isActive });

const gaugeRewardAddress = gaugeRewardPda(WIF3_GAUGE);
const rewardBefore = await decodeGaugeReward(gaugeRewardAddress);
log("gauge reward (before)", rewardBefore && {
	totalWeight: rewardBefore.totalWeight.toString(),
	rewardRateX64: rewardBefore.rewardRateX64.toString(),
	rewardPerWeightX64: rewardBefore.rewardPerWeightX64.toString(),
	periodFinish: rewardBefore.periodFinish.toString(),
	rewardMint: rewardBefore.rewardMint.toBase58(),
});

const pool = await dexClient.getPool(poolAddress, { maxAge: 0 });
const poolData = pool.getData();
const TICK_SPACING = poolData.tickSpacing;
log("pool", {
	tickCurrentIndex: poolData.tickCurrentIndex,
	tickSpacing: poolData.tickSpacing,
	liquidity: poolData.liquidity.toString(),
	tokenMintA: poolData.tokenMintA.toBase58(),
	tokenMintB: poolData.tokenMintB.toBase58(),
});

const assertEq = (label, actual, expected) => {
	const a = actual?.toString?.() ?? String(actual);
	const e = expected?.toString?.() ?? String(expected);
	if (a !== e) throw new Error(`ASSERTION FAILED: ${label}: expected ${e}, got ${a}`);
	console.log(`  OK  ${label} = ${a}`);
};
const assertTrue = (label, cond) => {
	if (!cond) throw new Error(`ASSERTION FAILED: ${label}`);
	console.log(`  OK  ${label}`);
};

// ---- Phase 1: open a fresh, narrow-range position around the current price ----
const tickLower = TickUtil.getInitializableTickIndex(poolData.tickCurrentIndex - 192, TICK_SPACING);
const tickUpper = TickUtil.getInitializableTickIndex(poolData.tickCurrentIndex + 192, TICK_SPACING);
log("new position range", { tickLower, tickUpper, currentTick: poolData.tickCurrentIndex });

const extensionContext = await TokenExtensionUtil.buildTokenExtensionContextForPool(
	dexCtx.fetcher,
	poolData.tokenMintA,
	poolData.tokenMintB,
	{ maxAge: 0 },
);
const depositQuote = increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
	poolData.tokenMintB,
	new Decimal("2000"),
	tickLower,
	tickUpper,
	Percentage.fromFraction(5, 100),
	pool,
	extensionContext,
);
const tickTx = await pool.initTickArrayForTicks([tickLower, tickUpper], wallet.publicKey, { maxAge: 0 });
if (tickTx) await buildAndExecute(tickTx, "tick arrays initialized");
const opened = await pool.openPosition(tickLower, tickUpper, depositQuote, wallet.publicKey, wallet.publicKey);
await buildAndExecute(opened.tx, "position opened");
const positionMint = opened.positionMint;
const positionAddress = PDAUtil.getPosition(DEX_PROGRAM_ID, positionMint).publicKey;
log("opened position", { positionMint: positionMint.toBase58(), positionAddress: positionAddress.toBase58() });

const tickArrayLower = PDAUtil.getTickArrayFromTickIndex(tickLower, TICK_SPACING, poolAddress, DEX_PROGRAM_ID).publicKey;
const tickArrayUpper = PDAUtil.getTickArrayFromTickIndex(tickUpper, TICK_SPACING, poolAddress, DEX_PROGRAM_ID).publicKey;

async function refreshPositionFees() {
	const refresh = SolveIx.updateFeesAndRewardsIx(dexCtx.program, {
		solve: poolAddress,
		position: positionAddress,
		tickArrayLower,
		tickArrayUpper,
	});
	await sendIx(refresh.instructions, "update_fees_and_rewards");
}

// ---- Phase 2: stake it (weight starts at zero by design) ----
const ownerPositionToken = getAssociatedTokenAddressSync(positionMint, wallet.publicKey);
const stakeAddress = gaugeStakePda(positionMint);
const custodyPositionToken = getAssociatedTokenAddressSync(positionMint, stakeAddress, true);

await sendIx(
	[
		stakePositionIx({
			owner: wallet.publicKey,
			gauge: WIF3_GAUGE,
			pool: poolAddress,
			gaugeReward: gaugeRewardAddress,
			position: positionAddress,
			positionMint,
			stake: stakeAddress,
			ownerPositionToken,
			custodyPositionToken,
		}),
	],
	"stake_position",
);

let stakeState = await decodeGaugeStake(stakeAddress);
let rewardState = await decodeGaugeReward(gaugeRewardAddress);
log("stake right after stake_position", stakeState);
assertEq("weight starts at zero", stakeState.weight, 0n);
assertEq("total_weight unchanged by a zero-weight stake", rewardState.totalWeight, rewardBefore.totalWeight);

// ---- Phase 3: generate real in-range trading fees on BOTH sides, then sync ----
// isqrt(delta_a * delta_b) needs both deltas nonzero -- a swap only charges
// its fee on the input side, so a single one-directional swap leaves the
// other side at zero and (a documented, real limitation of this geometric-
// mean weighting) would compute a weight of zero despite genuine one-sided
// fee income. Trade both directions so this test reflects the intended
// two-sided case.
async function tradeBothDirections(amountAWif3, amountBSolv3, label) {
	const quoteA = await swapQuoteByInputToken(
		pool,
		poolData.tokenMintA,
		new BN(amountAWif3).mul(new BN(10).pow(new BN(6))),
		Percentage.fromFraction(50, 100),
		DEX_PROGRAM_ID,
		dexCtx.fetcher,
		{ maxAge: 0 },
	);
	await buildAndExecute(await pool.swap(quoteA, wallet.publicKey), `${label}: swap A->B`);
	const quoteB = await swapQuoteByInputToken(
		pool,
		poolData.tokenMintB,
		new BN(amountBSolv3).mul(new BN(10).pow(new BN(9))),
		Percentage.fromFraction(50, 100),
		DEX_PROGRAM_ID,
		dexCtx.fetcher,
		{ maxAge: 0 },
	);
	await buildAndExecute(await pool.swap(quoteB, wallet.publicKey), `${label}: swap B->A`);
}

await tradeBothDirections(20, 5, "phase 3");

const poolAfterSwapA = (await dexClient.getPool(poolAddress, { maxAge: 0 })).getData();
log("pool after phase 3 swaps", { tickCurrentIndex: poolAfterSwapA.tickCurrentIndex });
assertTrue("phase 3 swaps kept price inside the position's range", poolAfterSwapA.tickCurrentIndex > tickLower && poolAfterSwapA.tickCurrentIndex < tickUpper);

await refreshPositionFees();
const positionAfterSwapA = await dexClient.getPosition(positionAddress, { maxAge: 0 });
const posDataA = positionAfterSwapA.getData();
log("position fee_owed after phase 3 swaps", { feeOwedA: posDataA.feeOwedA.toString(), feeOwedB: posDataA.feeOwedB.toString() });
assertTrue("fee_owed_a increased from trading", posDataA.feeOwedA.gtn(0));
assertTrue("fee_owed_b increased from trading", posDataA.feeOwedB.gtn(0));

await sendIx(
	[syncStakeIx({ caller: wallet.publicKey, gauge: WIF3_GAUGE, pool: poolAddress, position: positionAddress, gaugeReward: gaugeRewardAddress, stake: stakeAddress })],
	"sync_stake (in range)",
);

stakeState = await decodeGaugeStake(stakeAddress);
rewardState = await decodeGaugeReward(gaugeRewardAddress);
log("stake after first sync_stake", stakeState);
log("gauge reward after first sync_stake", { totalWeight: rewardState.totalWeight.toString() });
assertTrue("weight became nonzero from real fee activity", stakeState.weight > 0n);
assertTrue("not paused while in range", !stakeState.isPaused);
assertEq("total_weight = ghost legacy weight + this stake's new weight", rewardState.totalWeight, rewardBefore.totalWeight + stakeState.weight);
assertEq("accrued_rewards still zero (old weight was zero going into this sync)", stakeState.accruedRewards, 0n);

// ---- Phase 4: let real reward-stream time elapse, sync again, confirm accrual at the OLD (now nonzero) weight ----
await new Promise((resolve) => setTimeout(resolve, 8000));
await tradeBothDirections(15, 4, "phase 4");
const poolAfterNudge = (await dexClient.getPool(poolAddress, { maxAge: 0 })).getData();
assertTrue("phase 4 swaps kept price inside the position's range", poolAfterNudge.tickCurrentIndex > tickLower && poolAfterNudge.tickCurrentIndex < tickUpper);

await refreshPositionFees();
await sendIx(
	[syncStakeIx({ caller: wallet.publicKey, gauge: WIF3_GAUGE, pool: poolAddress, position: positionAddress, gaugeReward: gaugeRewardAddress, stake: stakeAddress })],
	"sync_stake (second, in range)",
);
stakeState = await decodeGaugeStake(stakeAddress);
rewardState = await decodeGaugeReward(gaugeRewardAddress);
log("stake after second sync_stake", stakeState);
assertTrue("accrued_rewards credited from elapsed reward stream at the previous weight", stakeState.accruedRewards > 0n);
assertTrue("weight re-derived again from new fee activity", stakeState.weight > 0n);
const totalWeightBeforePauseSync = rewardState.totalWeight;

// ---- Phase 5: push price out of range, sync, confirm weight zeroes and pauses ----
// My own concentrated deposit now dominates the active liquidity at the
// current tick, so a fixed swap size calibrated against the pre-deposit
// pool would barely move price. Escalate until a fresh quote actually
// projects past the range boundary instead of guessing a fixed amount.
async function findSwapToExitRange(startAmountUi) {
	let amount = startAmountUi;
	for (let i = 0; i < 16; i++) {
		const quote = await swapQuoteByInputToken(
			pool,
			poolData.tokenMintA,
			new BN(Math.floor(amount)).mul(new BN(10).pow(new BN(6))),
			Percentage.fromFraction(50, 100),
			DEX_PROGRAM_ID,
			dexCtx.fetcher,
			{ maxAge: 0 },
		);
		if (quote.estimatedEndTickIndex <= tickLower) return quote;
		amount *= 2;
	}
	throw new Error("could not find a swap size that exits the position's range");
}
const bigSwap = await findSwapToExitRange(200);
await buildAndExecute(await pool.swap(bigSwap, wallet.publicKey), "swap C (push price out of range)");
const poolAfterBigSwap = (await dexClient.getPool(poolAddress, { maxAge: 0 })).getData();
log("pool after swap C", { tickCurrentIndex: poolAfterBigSwap.tickCurrentIndex });
assertTrue("swap C moved price outside the position's range", poolAfterBigSwap.tickCurrentIndex <= tickLower || poolAfterBigSwap.tickCurrentIndex >= tickUpper);

await refreshPositionFees();
await sendIx(
	[syncStakeIx({ caller: wallet.publicKey, gauge: WIF3_GAUGE, pool: poolAddress, position: positionAddress, gaugeReward: gaugeRewardAddress, stake: stakeAddress })],
	"sync_stake (now out of range)",
);
const weightBeforePause = stakeState.weight;
stakeState = await decodeGaugeStake(stakeAddress);
rewardState = await decodeGaugeReward(gaugeRewardAddress);
log("stake after out-of-range sync", stakeState);
assertEq("weight zeroed out of range", stakeState.weight, 0n);
assertTrue("is_paused set", stakeState.isPaused);
assertEq("total_weight dropped by exactly the removed weight", rewardState.totalWeight, totalWeightBeforePauseSync - weightBeforePause);

// ---- Phase 6: claim whatever genuinely accrued while in range ----
const rewardMint = rewardState.rewardMint;
const rewardVault = getAssociatedTokenAddressSync(rewardMint, gaugeRewardAddress, true);
const ownerRewardToken = getAssociatedTokenAddressSync(rewardMint, wallet.publicKey);
const accruedBeforeClaim = stakeState.accruedRewards;
log("accrued_rewards to claim", accruedBeforeClaim.toString());

if (accruedBeforeClaim > 0n) {
	await sendIx(
		[
			claimGaugeRewardsIx({
				owner: wallet.publicKey,
				gauge: WIF3_GAUGE,
				pool: poolAddress,
				position: positionAddress,
				gaugeReward: gaugeRewardAddress,
				stake: stakeAddress,
				rewardMint,
				rewardVault,
				ownerRewardToken,
			}),
		],
		"claim_gauge_rewards",
	);
	stakeState = await decodeGaugeStake(stakeAddress);
	assertEq("accrued_rewards reset to zero after claim", stakeState.accruedRewards, 0n);
} else {
	console.log("(nothing accrued yet -- skipping claim_gauge_rewards call)");
}

// ---- Phase 7: unstake, confirm total_weight bookkeeping and position returned ----
await sendIx(
	[
		unstakePositionIx({
			owner: wallet.publicKey,
			gauge: WIF3_GAUGE,
			pool: poolAddress,
			position: positionAddress,
			gaugeReward: gaugeRewardAddress,
			stake: stakeAddress,
			positionMint,
			custodyPositionToken,
			ownerPositionToken,
			rewardMint,
			rewardVault,
			ownerRewardToken,
		}),
	],
	"unstake_position",
);

const rewardAfterUnstake = await decodeGaugeReward(gaugeRewardAddress);
const stakeAfterUnstake = await connection.getAccountInfo(stakeAddress, "confirmed");
log("gauge reward after unstake", { totalWeight: rewardAfterUnstake.totalWeight.toString() });
assertEq("total_weight back to the pre-test ghost baseline", rewardAfterUnstake.totalWeight, rewardBefore.totalWeight);
assertTrue("stake account closed", stakeAfterUnstake === null);

const returnedPositionToken = await connection.getTokenAccountBalance(ownerPositionToken).catch(() => null);
assertTrue("position NFT returned to owner", returnedPositionToken?.value.amount === "1");

console.log("\n=== ALL EMISSIONS-REDESIGN VERIFICATION CHECKS PASSED ===");
