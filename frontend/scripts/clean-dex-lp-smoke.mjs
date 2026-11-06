// Devnet: the LP flow the site uses (open a position with liquidity, then withdraw part of it) through the
// app SDK against the clean Apache program, to capture real transactions that carry the position events.
// Prints the signatures. Same env as clean-dex-sdk-smoke.mjs.
import fs from "node:fs";
import { Wallet, BN } from "@coral-xyz/anchor";
import svmUtilities from "@solve3fi/common";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import {
	buildSolveClient, decreaseLiquidityQuoteByLiquidity, increaseLiquidityQuoteByInputTokenUsingPriceSlippage,
	PDAUtil, PoolUtil, SolveContext, TickUtil, TokenExtensionUtil,
} from "@solve3fi/sdk";

const { Percentage } = svmUtilities;
const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.SOLVE3_KEYPAIR, "utf8"))));
const PROGRAM_ID = new PublicKey(process.env.SOLVE3_DEX);
const CONFIG = new PublicKey(process.env.SOLVE3_CONFIG);
const TUSDC = new PublicKey("FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up");
const TBRIBE = new PublicKey("BdsGWxAqx8FkoMrG4XXPhVnJYw63TnrNEyUgGS8idxm7");
const SPACING = 64;
const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const ctx = SolveContext.from(connection, new Wallet(keypair), PROGRAM_ID);
const client = buildSolveClient(ctx);

const run = async (builder, label) => {
	const sig = await builder.buildAndExecute({ blockhashCommitment: "confirmed" });
	await connection.confirmTransaction(sig, "confirmed");
	console.log(label, sig);
	return sig;
};

const [mintA, mintB] = PoolUtil.orderMints(TBRIBE, TUSDC);
const poolAddress = PDAUtil.getSolve(PROGRAM_ID, CONFIG, mintA, mintB, SPACING).publicKey;
const pool = await client.getPool(poolAddress, { maxAge: 0 });
const current = pool.getData().tickCurrentIndex;
const lower = TickUtil.getInitializableTickIndex(current - 640, SPACING);
const upper = TickUtil.getInitializableTickIndex(current + 640, SPACING);
const ext = await TokenExtensionUtil.buildTokenExtensionContextForPool(ctx.fetcher, mintA, mintB, { maxAge: 0 });
const quote = increaseLiquidityQuoteByInputTokenUsingPriceSlippage(TUSDC, new Decimal("200"), lower, upper, Percentage.fromFraction(1, 100), pool, ext);
const tickTx = await pool.initTickArrayForTicks([lower, upper], keypair.publicKey, { maxAge: 0 });
if (tickTx) await run(tickTx, "initTickArrayForTicks");
const opened = await pool.openPosition(lower, upper, quote, keypair.publicKey, keypair.publicKey);
const openSig = await run(opened.tx, "openPosition+increase");

const positionAddress = PDAUtil.getPosition(PROGRAM_ID, opened.positionMint).publicKey;
const position = await client.getPosition(positionAddress, { maxAge: 0 });
const half = position.getData().liquidity.div(new BN(2));
const freshPool = await client.getPool(poolAddress, { maxAge: 0 });
const decrease = decreaseLiquidityQuoteByLiquidity(half, Percentage.fromFraction(1, 100), position, freshPool, ext);
const decSig = await run(await position.decreaseLiquidity(decrease, true), "decreaseLiquidity");
console.log(JSON.stringify({ position: positionAddress.toBase58(), lower, upper, liquidityOpened: quote.liquidityAmount.toString(), liquidityRemoved: half.toString(), openSig, decSig }));
