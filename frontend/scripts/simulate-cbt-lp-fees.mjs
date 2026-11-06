// Public, read-only devnet verification. No keypair files, signing or submission.
import assert from "node:assert/strict";
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SolveContext, SolveRouterBuilder, RouterUtils, IGNORE_CACHE } from "@solve3fi/sdk";
import utilities from "@solve3fi/common";
import BN from "bn.js";

const { Percentage } = utilities;
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const owner = new PublicKey("HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o");
const poolAddress = new PublicKey("DaLDjZTEQpsSeAnrQsTCARHuRKgSeiixGAA2Fv35R24X");
const inputMint = new PublicKey("FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up");
const outputMint = new PublicKey("9ueYeFVEbPpet57eJjMt9QuwtjEbYykpUZMw4zFY1SJq");
const wallet = {
  publicKey: owner,
  signTransaction: () => { throw new Error("Read-only simulation cannot sign"); },
  signAllTransactions: () => { throw new Error("Read-only simulation cannot sign"); },
};
const ctx = SolveContext.from(connection, wallet, new PublicKey("Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb"));
const initial = await ctx.program.account.solve.fetch(poolAddress);
if (initial.protocolFeeRate !== 0) {
  throw new Error(`Waiting for fee-policy application: CBt/devUSDC protocolFeeRate is ${initial.protocolFeeRate}, expected 0; no simulation attempted`);
}
assert.equal(initial.tokenMintA.toString(), outputMint.toString());
assert.equal(initial.tokenMintB.toString(), inputMint.toString());
assert.equal(initial.feeRate, 10_000, "expected 1% swap fee");
const inputBalance = await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(inputMint, owner));
assert.ok(BigInt(inputBalance.value.amount) >= 1_000_000n, "wallet must have at least 1 devUSDC for the unsigned simulation");

const router = await SolveRouterBuilder.buildWithPools(ctx, [poolAddress]);
const trade = { tokenIn: inputMint.toString(), tokenOut: outputMint.toString(), tradeAmount: new BN("1000000"), amountSpecifiedIsInput: true };
const result = await router.findBestRoute(trade, RouterUtils.getDefaultRouteOptions(), RouterUtils.getDefaultSelectOptions(), IGNORE_CACHE);
const route = result?.[0];
assert.ok(route, "a direct CBt/devUSDC quote must exist");
assert.equal(route.subRoutes.length, 1, "verification requires one route");
assert.equal(route.subRoutes[0].hopQuotes.length, 1, "verification requires one hop");
const quoteFee = BigInt(route.subRoutes[0].hopQuotes[0].quote.estimatedFeeAmount.toString());
assert.equal(quoteFee, 10_000n, "1 devUSDC should produce a 0.01 devUSDC trading fee");
const builder = await router.swap(route, Percentage.fromFraction(5, 1000), null);
const compressed = builder.compressIx(true);
const baseline = await connection.getAccountInfoAndContext(poolAddress, "confirmed");
assert.ok(baseline.value, "pool must exist");
const before = ctx.program.coder.accounts.decode("solve", baseline.value.data);
assert.equal(before.protocolFeeRate, 0, "fee policy must still be LP100%");
const block = await connection.getLatestBlockhash("confirmed");
const message = new TransactionMessage({ payerKey: owner, recentBlockhash: block.blockhash, instructions: compressed.instructions }).compileToV0Message();
const transaction = new VersionedTransaction(message);
const simulation = await connection.simulateTransaction(transaction, {
  sigVerify: false, replaceRecentBlockhash: true, minContextSlot: baseline.context.slot,
  accounts: { encoding: "base64", addresses: [poolAddress.toString()] },
});
assert.equal(simulation.value.err, null, `unsigned swap simulation failed: ${JSON.stringify(simulation.value.err)}; ${simulation.value.logs?.join(" | ")}`);
const simulatedAccount = simulation.value.accounts?.[0];
assert.ok(simulatedAccount, "simulation must return the post-swap pool account");
const after = ctx.program.coder.accounts.decode("solve", Buffer.from(simulatedAccount.data[0], "base64"));
// Refuse a potentially misleading before/after comparison if another actor
// changed the real pool while this read-only simulation was running.
const actual = await connection.getAccountInfo(poolAddress, { commitment: "confirmed", minContextSlot: simulation.context.slot });
assert.ok(actual?.data.equals(baseline.value.data), "live pool changed concurrently; rerun this read-only check against a stable snapshot");
assert.equal(after.protocolFeeRate, 0);
assert.equal(after.protocolFeeOwedA.toString(), before.protocolFeeOwedA.toString());
assert.equal(after.protocolFeeOwedB.toString(), before.protocolFeeOwedB.toString());
assert.equal(after.feeGrowthGlobalA.toString(), before.feeGrowthGlobalA.toString(), "only devUSDC/input fee growth should change");
assert.equal(after.liquidity.toString(), before.liquidity.toString(), "verification requires unchanged active liquidity");
const liquidity = BigInt(before.liquidity.toString());
const growthDelta = BigInt(after.feeGrowthGlobalB.toString()) - BigInt(before.feeGrowthGlobalB.toString());
const expectedGrowthDelta = (quoteFee << 64n) / liquidity;
assert.equal(growthDelta, expectedGrowthDelta, "LP fee growth must represent the entire swap fee, subject only to Q64 rounding");
console.log(JSON.stringify({
  readOnly: true, transactionSigned: false, transactionSubmitted: false,
  pool: poolAddress.toString(), slot: simulation.context.slot, protocolFeeRate: after.protocolFeeRate,
  inputDevUSDC: "1", tradingFeeDevUSDC: "0.01", lpSharePercent: 100,
  protocolFeeOwedAUnchanged: after.protocolFeeOwedA.toString(), protocolFeeOwedBUnchanged: after.protocolFeeOwedB.toString(),
  lpFeeGrowthDeltaB: growthDelta.toString(), expectedFullFeeGrowthDeltaB: expectedGrowthDelta.toString(),
  unitsConsumed: simulation.value.unitsConsumed,
  outputCbtRaw: route.totalAmountOut.toString(),
}, null, 2));
