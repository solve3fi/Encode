import fs from "node:fs";
import { Wallet } from "@coral-xyz/anchor";
import svmUtilities from "@solve3fi/common";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
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
const TICK_SPACING = 64;

const SOLV3 = { symbol: "SOLV3", mint: new PublicKey("9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn"), decimals: 9 };
const DEVUSDC = { symbol: "devUSDC", mint: new PublicKey("FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up"), decimals: 6 };
const WSOL = { symbol: "SOL", mint: NATIVE_MINT, decimals: 9 };
const TSOL = { symbol: "tSOL", mint: new PublicKey("6RydWWDfVxTgmDWHSwrcEitrjySqMohnf4vfSWx4ka1f"), decimals: 9 };
const TBRIBE = { symbol: "TBRIBE", mint: new PublicKey("BdsGWxAqx8FkoMrG4XXPhVnJYw63TnrNEyUgGS8idxm7"), decimals: 6 };

// [base, quote, liquidity input amount denominated in `quote`]
const NEW_POOLS = [
  { base: TSOL, quote: DEVUSDC, liquidityInput: new Decimal("10000") },
  { base: SOLV3, quote: WSOL, liquidityInput: new Decimal("1.5") },
  { base: TBRIBE, quote: DEVUSDC, liquidityInput: new Decimal("10000") },
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

// devUSDC's own mint authority is this wallet — top it up directly instead
// of relying on the public faucet route, which is sized for a single user
// claim, not seeding several pools with 10,000 devUSDC of depth each.
async function ensureDevUsdcBalance(minAmount) {
  const ata = getAssociatedTokenAddressSync(DEVUSDC.mint, wallet.publicKey);
  const info = await connection.getAccountInfo(ata);
  const current = info
    ? (await connection.getTokenAccountBalance(ata)).value.uiAmount ?? 0
    : 0;
  if (current >= minAmount) {
    console.log(`devUSDC balance already sufficient: ${current}`);
    return;
  }
  const shortfall = minAmount - current;
  const rawAmount = BigInt(new Decimal(shortfall).mul(10 ** DEVUSDC.decimals).ceil().toString());
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      ata,
      wallet.publicKey,
      DEVUSDC.mint,
    ),
    createMintToInstruction(DEVUSDC.mint, ata, wallet.publicKey, rawAmount),
  );
  const signature = await connection.sendTransaction(tx, [keypair]);
  await connection.confirmTransaction(signature, "confirmed");
  console.log(`minted ${shortfall} devUSDC: ${signature}`);
}

// wSOL needs an actual wrapped token account, not just a lamport balance —
// create the ATA and sync it to the requested amount above whatever's
// already wrapped there.
async function ensureWrappedSol(minAmount) {
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
  const info = await connection.getAccountInfo(ata);
  const current = info
    ? (await connection.getTokenAccountBalance(ata)).value.uiAmount ?? 0
    : 0;
  if (current >= minAmount) {
    console.log(`wSOL balance already sufficient: ${current}`);
    return;
  }
  const shortfall = minAmount - current;
  const lamports = BigInt(new Decimal(shortfall).mul(1e9).ceil().toString());
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      ata,
      wallet.publicKey,
      NATIVE_MINT,
    ),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: ata,
      lamports,
    }),
    createSyncNativeInstruction(ata),
  );
  const signature = await connection.sendTransaction(tx, [keypair]);
  await connection.confirmTransaction(signature, "confirmed");
  console.log(`wrapped ${shortfall} SOL: ${signature}`);
}

await ensureDevUsdcBalance(31000);
await ensureWrappedSol(3.5);

for (const { base, quote, liquidityInput } of NEW_POOLS) {
  const label = `${base.symbol}/${quote.symbol}`;
  const [mintA, mintB] = PoolUtil.orderMints(base.mint, quote.mint);
  const decimalsA = mintA.equals(base.mint) ? base.decimals : quote.decimals;
  const decimalsB = mintB.equals(base.mint) ? base.decimals : quote.decimals;
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
    await execute(tx, `${label} pool created`);
    if (!poolKey.equals(poolPda)) throw new Error(`Unexpected ${label} pool address`);
    poolExists = true;
  } else {
    console.log(`${label} pool already exists: ${poolPda}`);
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
    const quote_ = increaseLiquidityQuoteByInputTokenUsingPriceSlippage(
      quote.mint,
      liquidityInput,
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
    if (tickTx) await execute(tickTx, `${label} tick arrays initialized`);
    const opened = await pool.openPosition(
      tickLower,
      tickUpper,
      quote_,
      wallet.publicKey,
      wallet.publicKey,
    );
    positionMint = opened.positionMint.toBase58();
    await execute(opened.tx, `${label} liquidity funded`);
  } else {
    console.log(`${label} already funded: ${existingLiquidity.toString()} liquidity`);
  }

  results.push({
    label,
    pool: poolPda.toBase58(),
    positionMint,
  });
}

console.log(JSON.stringify({ cluster: "devnet", pools: results }, null, 2));
