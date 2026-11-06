import fs from "node:fs";
import { Wallet } from "@coral-xyz/anchor";
import svmUtilities from "@solve3fi/common";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
  buildSolveClient,
  increaseLiquidityQuoteByInputTokenUsingPriceSlippage,
  PDAUtil,
  PoolUtil,
  PriceMath,
  SolveContext,
  TickUtil,
  TokenExtensionUtil,
} from "@solve3fi/sdk";

const { Percentage } = svmUtilities;
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.SOLVE3_KEYPAIR ?? "D:/Projects/ve33-contracts/id.json";
const PROGRAM_ID = new PublicKey("Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb");
const CONFIG = new PublicKey("Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG");
const SOLV3 = new PublicKey("9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn");
const TICK_SPACING = 64;
const LIQUIDITY_INPUT_SOLV3 = new Decimal("10000");
const MEMES = [
  { symbol: "tSOL", mint: new PublicKey("6RydWWDfVxTgmDWHSwrcEitrjySqMohnf4vfSWx4ka1f"), decimals: 9 },
  { symbol: "TBRIBE", mint: new PublicKey("BdsGWxAqx8FkoMrG4XXPhVnJYw63TnrNEyUgGS8idxm7"), decimals: 6 },
];

const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"))),
);
const connection = new Connection(RPC, "confirmed");
const wallet = new Wallet(keypair);
const ctx = SolveContext.from(connection, wallet, PROGRAM_ID);
const client = buildSolveClient(ctx);
const results = [];

async function execute(tx, label) {
  const signature = await tx.buildAndExecute({ blockhashCommitment: "confirmed" });
  await connection.confirmTransaction(signature, "confirmed");
  console.log(`${label}: ${signature}`);
  return signature;
}

for (const meme of MEMES) {
  const [mintA, mintB] = PoolUtil.orderMints(SOLV3, meme.mint);
  const decimalsA = mintA.equals(SOLV3) ? 9 : meme.decimals;
  const decimalsB = mintB.equals(SOLV3) ? 9 : meme.decimals;
  const tick = TickUtil.getInitializableTickIndex(
    PriceMath.priceToTickIndex(new Decimal(1), decimalsA, decimalsB),
    TICK_SPACING,
  );
  const poolPda = PDAUtil.getSolve(PROGRAM_ID, CONFIG, mintA, mintB, TICK_SPACING).publicKey;
  let poolExists = Boolean(await connection.getAccountInfo(poolPda, "confirmed"));

  if (!poolExists) {
    const { tx, poolKey } = await client.createPool(
      CONFIG,
      mintA,
      mintB,
      TICK_SPACING,
      tick,
      wallet.publicKey,
    );
    await execute(tx, `${meme.symbol} pool created`);
    if (!poolKey.equals(poolPda)) throw new Error(`Unexpected ${meme.symbol} pool address`);
    poolExists = true;
  } else {
    console.log(`${meme.symbol} pool already exists: ${poolPda}`);
  }

  const pool = await client.getPool(poolPda, { maxAge: 0 });
  const existingLiquidity = pool.getData().liquidity;
  let positionMint = null;
  if (existingLiquidity.isZero()) {
    const [tickLower, tickUpper] = TickUtil.getFullRangeTickIndex(TICK_SPACING);
    const extensionContext = await TokenExtensionUtil.buildTokenExtensionContextForPool(
      ctx.fetcher,
      mintA,
      mintB,
      { maxAge: 0 },
    );
    const quote = increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
      SOLV3,
      LIQUIDITY_INPUT_SOLV3,
      tickLower,
      tickUpper,
      Percentage.fromFraction(1, 100),
      pool,
      extensionContext,
    );
    const tickTx = await pool.initTickArrayForTicks(
      [tickLower, tickUpper],
      wallet.publicKey,
      { maxAge: 0 },
    );
    if (tickTx) await execute(tickTx, `${meme.symbol} tick arrays initialized`);
    const opened = await pool.openPosition(
      tickLower,
      tickUpper,
      quote,
      wallet.publicKey,
      wallet.publicKey,
    );
    positionMint = opened.positionMint.toBase58();
    await execute(opened.tx, `${meme.symbol} liquidity funded`);
  } else {
    console.log(`${meme.symbol} already funded: ${existingLiquidity.toString()} liquidity`);
  }

  results.push({
    symbol: meme.symbol,
    mint: meme.mint.toBase58(),
    pool: poolPda.toBase58(),
    positionMint,
  });
}

console.log(JSON.stringify({ cluster: "devnet", pools: results }, null, 2));
