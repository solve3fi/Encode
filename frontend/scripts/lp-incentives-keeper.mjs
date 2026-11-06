import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import { PriceMath, SolveContext } from "@solve3fi/sdk";
import bs58 from "bs58";
import Decimal from "decimal.js";
import { applySample, emptyLedger } from "./lib/lp-incentive-accrual.mjs";

// Soft-launch LP incentive keeper. Samples each incentivized pool (configured
// in the Admin UI, data/lp-incentives.json), measures the protocol fees that
// accrued since the previous sample (protocolFeeOwedA/B deltas — whatever the
// on-chain protocolFeeRate really is), and credits veSOLV3 to the wallets
// holding in-range positions at the sample, pro-rata by liquidity. Writes
// data/lp-incentives-ledger.json, which the app reads for the Bonus APR
// column and the per-wallet "veSOLV3 bonus" on My Pools. Read-only on chain:
// no signer, no transactions.
//
// Like auto-vote-keeper.mjs this reads/writes the app's data/*.json files
// directly off disk (same host as the Next.js app), not through its API.
//
// Cron (every 10 min):   */10 * * * *  cd /srv/solve3 && bun scripts/lp-incentives-keeper.mjs
// Env:  SOLVE3_RPC_URL (default devnet public RPC), SOLVE3_CLUSTER=devnet|mainnet
//       (default devnet), JUPITER_PRICE_URL (mainnet pricing override).
// Flags: --dry-run (compute, print, do not write), --once is implied (one
//        sample per invocation; cron provides the cadence).
//
// Never invents state: a pool's first run only records a baseline; a missing
// price or RPC failure skips that pool for this run and the next successful
// run picks the delta up from the last *recorded* sample.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "lp-incentives.json");
const LEDGER_FILE = path.join(DATA_DIR, "lp-incentives-ledger.json");

const CLUSTER = process.env.SOLVE3_CLUSTER === "mainnet" ? "mainnet" : "devnet";
const RPC_URL =
	process.env.SOLVE3_RPC_URL ??
	(CLUSTER === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");
// Mirrors src/configs/addresses.ts (DEX_PROGRAM_ID / PROGRAM_CONFIG).
const DEX = {
	devnet: {
		programId: "Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb",
		config: "Fnc66UJ8MMJ6t2zFM8TEx5wzcQpcXo8pAQEpTBjwnEBG",
		stableMint: "FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up", // devUSDC
	},
	mainnet: {
		// Mainnet DEX is not redeployed yet (see addresses.ts); update on launch.
		programId: process.env.SOLVE3_DEX_PROGRAM_ID ?? "Hvk9udYr7cFfsXN2yTKb94A5pLM7H9YvAQtnV5JQfwvz",
		config: process.env.SOLVE3_DEX_CONFIG ?? "FWv7G8LcHMiNgpzn7srEaFQi44T4hbC5qtYqjD8Ay4Qx",
		stableMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
	},
}[CLUSTER];
const JUPITER_PRICE_URL = process.env.JUPITER_PRICE_URL ?? "https://lite-api.jup.ag/price/v3";
const TOKEN_PROGRAMS = [
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
	"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];

const dryRun = process.argv.includes("--dry-run");
const log = (action, details = {}) =>
	console.log(JSON.stringify({ timestamp: new Date().toISOString(), action, ...details }));

const readJson = (file, fallback) => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return fallback;
		throw error;
	}
};

// tmp + rename so the app never reads a half-written ledger.
const writeJsonAtomic = (file, value) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
	fs.renameSync(tmp, file);
};

// Public RPCs rate-limit per-method; a 429 is retried a few times with
// backoff before the pool is skipped for this run.
async function withRetry(label, fn, attempts = 5) {
	let delay = 2000;
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await fn();
		} catch (error) {
			if (attempt >= attempts || !/429|Too Many Requests/i.test(error.message ?? "")) throw error;
			log("retry", { label, attempt, delayMs: delay });
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay *= 2;
		}
	}
}

const readOnlyWallet = {
	publicKey: PublicKey.default,
	signTransaction: async () => { throw new Error("Read only"); },
	signAllTransactions: async () => { throw new Error("Read only"); },
};

// SPL token account layout: mint @0, owner @32, amount (u64 LE) @64. A
// position NFT has supply 1, so the account holding amount == 1 is the owner.
const AMOUNT_ONE_B58 = bs58.encode(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]));

// Strategy 1: getTokenLargestAccounts (cheap; heavily throttled on the public
// RPCs, fine on Helius/Triton/QuickNode).
async function ownerViaLargestAccounts(connection, mint) {
	const largest = await withRetry("getTokenLargestAccounts", () => connection.getTokenLargestAccounts(mint));
	const holder = largest.value.find((entry) => entry.amount === "1");
	if (!holder) return null;
	const info = await withRetry("getAccountInfo", () => connection.getAccountInfo(holder.address, "confirmed"));
	if (!info || !TOKEN_PROGRAMS.includes(info.owner.toBase58())) return null;
	return new PublicKey(info.data.subarray(32, 64)).toBase58();
}

// Strategy 2: filtered getProgramAccounts on both token programs (blocked on
// the public RPCs, which exclude the token program from secondary indexes).
async function ownerViaProgramAccounts(connection, mint) {
	for (const programId of TOKEN_PROGRAMS) {
		const accounts = await withRetry("getProgramAccounts", () =>
			connection.getProgramAccounts(new PublicKey(programId), {
				commitment: "confirmed",
				dataSlice: { offset: 32, length: 32 },
				filters: [
					{ memcmp: { offset: 0, bytes: mint.toBase58() } },
					{ memcmp: { offset: 64, bytes: AMOUNT_ONE_B58 } },
				],
			}),
		);
		if (accounts.length === 1) return new PublicKey(accounts[0].account.data).toBase58();
		if (accounts.length > 1) {
			log("owner-ambiguous", { mint: mint.toBase58(), holders: accounts.length });
			return null;
		}
	}
	return null;
}

/** Owner wallet of each position NFT; a mint that cannot be resolved is left out. */
async function resolveOwners(connection, positionMints) {
	const owners = new Map();
	for (const mint of positionMints) {
		let owner = null;
		for (const strategy of [ownerViaLargestAccounts, ownerViaProgramAccounts]) {
			try {
				owner = await strategy(connection, mint);
				if (owner) break;
			} catch (error) {
				log("owner-lookup-failed", { mint: mint.toBase58(), strategy: strategy.name, error: error.message.slice(0, 160) });
			}
		}
		if (owner) owners.set(mint.toBase58(), owner);
	}
	return owners;
}

/**
 * USD price per whole token for the pool's two mints. The stable side is $1;
 * the other side comes from Jupiter on mainnet, or from the pool's own spot
 * price on devnet (only meaningful for pools paired with the test stable).
 * Returns null when a price is unavailable — the caller then skips the pool.
 */
async function priceMints(pool, decimalsA, decimalsB) {
	const mintA = pool.tokenMintA.toBase58();
	const mintB = pool.tokenMintB.toBase58();
	const prices = {};
	if (mintA === DEX.stableMint) prices[mintA] = "1";
	if (mintB === DEX.stableMint) prices[mintB] = "1";
	const missing = [mintA, mintB].filter((mint) => !prices[mint]);
	if (!missing.length) return prices;

	if (CLUSTER === "devnet") {
		// Spot price of A in B from sqrtPrice; only one side can be missing.
		if (missing.length !== 1) return null;
		const priceAinB = PriceMath.sqrtPriceX64ToPrice(pool.sqrtPrice, decimalsA, decimalsB);
		prices[mintA] = prices[mintA] ?? priceAinB.toFixed();
		prices[mintB] = prices[mintB] ?? new Decimal(1).div(priceAinB).toFixed();
		return prices;
	}

	const response = await fetch(`${JUPITER_PRICE_URL}?ids=${missing.join(",")}`);
	if (!response.ok) return null;
	const body = await response.json();
	for (const mint of missing) {
		const price = body?.[mint]?.usdPrice ?? body?.data?.[mint]?.price;
		if (!(Number(price) > 0)) return null;
		prices[mint] = String(price);
	}
	return prices;
}

async function samplePool(ctx, connection, poolAddress) {
	const poolKey = new PublicKey(poolAddress);
	const slot = await connection.getSlot("confirmed");
	const pool = await ctx.program.account.solve.fetch(poolKey, "confirmed");
	const [mintA, mintB] = await Promise.all([
		ctx.fetcher.getMintInfo(pool.tokenMintA),
		ctx.fetcher.getMintInfo(pool.tokenMintB),
	]);
	if (!mintA || !mintB) throw new Error("Mint info unavailable");
	const prices = await priceMints(pool, mintA.decimals, mintB.decimals);
	const raw = await ctx.program.account.position.all([
		{ memcmp: { offset: 8, bytes: poolKey.toBase58() } },
	]);
	const owners = await resolveOwners(
		connection,
		raw.map((entry) => entry.account.positionMint),
	);
	const positions = raw.map((entry) => ({
		address: entry.publicKey.toBase58(),
		owner: owners.get(entry.account.positionMint.toBase58()) ?? null,
		liquidity: entry.account.liquidity.toString(),
		tickLowerIndex: entry.account.tickLowerIndex,
		tickUpperIndex: entry.account.tickUpperIndex,
	}));
	return {
		slot,
		ts: Math.floor(Date.now() / 1000),
		owedA: pool.protocolFeeOwedA.toString(),
		owedB: pool.protocolFeeOwedB.toString(),
		decimalsA: mintA.decimals,
		decimalsB: mintB.decimals,
		priceA: prices?.[pool.tokenMintA.toBase58()] ?? null,
		priceB: prices?.[pool.tokenMintB.toBase58()] ?? null,
		tickCurrentIndex: pool.tickCurrentIndex,
		protocolFeeRate: pool.protocolFeeRate,
		positions,
		unownedPositions: positions.filter((position) => !position.owner).length,
		// An in-range position whose NFT holder could not be resolved would
		// silently hand its share to the others, so such a sample is not recorded.
		unresolvedInRange: positions.filter(
			(position) =>
				!position.owner &&
				position.liquidity !== "0" &&
				position.tickLowerIndex <= pool.tickCurrentIndex &&
				pool.tickCurrentIndex < position.tickUpperIndex,
		).length,
	};
}

async function main() {
	const config = readJson(CONFIG_FILE, null);
	if (!config?.pools) {
		log("no-config", { file: CONFIG_FILE });
		return;
	}
	const active = Object.values(config.pools).filter((pool) => pool.status === "active");
	if (!active.length) {
		log("no-active-pools");
		return;
	}
	const veSolv3Usd = Number(config.veSolv3Usd) > 0 ? config.veSolv3Usd : 0.3;

	const connection = new Connection(RPC_URL, "confirmed");
	const ctx = SolveContext.from(connection, readOnlyWallet, new PublicKey(DEX.programId));
	let ledger = readJson(LEDGER_FILE, emptyLedger());
	let changed = false;

	for (const incentive of active) {
		let sample;
		try {
			sample = await samplePool(ctx, connection, incentive.poolAddress);
		} catch (error) {
			log("sample-failed", { pool: incentive.poolAddress, error: error.message });
			continue;
		}
		if (sample.priceA === null || sample.priceB === null) {
			log("price-unavailable", { pool: incentive.poolAddress });
			continue;
		}
		if (sample.unresolvedInRange > 0) {
			log("owner-unresolved", { pool: incentive.poolAddress, positions: sample.unresolvedInRange });
			continue;
		}
		if (sample.protocolFeeRate !== incentive.feeShareBps) {
			log("rate-mismatch", {
				pool: incentive.poolAddress,
				onChain: sample.protocolFeeRate,
				configured: incentive.feeShareBps,
			});
		}
		const result = applySample(ledger, incentive.poolAddress, sample, {
			multiplier: incentive.multiplier,
			veSolv3Usd,
			weeklyCapSolv3: incentive.weeklyCapSolv3,
		});
		log(result.reason, {
			pool: incentive.poolAddress,
			slot: sample.slot,
			feesUsd: result.feesUsd,
			creditSolv3: result.creditSolv3,
			collected: result.collected ?? false,
			positions: sample.positions.length,
			unownedPositions: sample.unownedPositions,
			tick: sample.tickCurrentIndex,
		});
		if (result.applied) {
			ledger = result.ledger;
			changed = true;
		}
	}

	if (!changed) return;
	if (dryRun) {
		log("dry-run", { wallets: Object.keys(ledger.wallets).length });
		return;
	}
	writeJsonAtomic(LEDGER_FILE, ledger);
	log("ledger-written", { file: LEDGER_FILE, pools: Object.keys(ledger.pools).length });
}

main().catch((error) => {
	log("fatal", { error: error.message });
	process.exitCode = 1;
});
