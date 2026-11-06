import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey, Transaction } from "@solana/web3.js";

// These are shares of the trading fee, in basis points (10_000 = 100%).
// 100% is enabled only after a pool has native, liquidity-weighted emissions.
// Never deploy this reconciler before both contracts and gauges are migrated.
export const UNGAUGED_PROTOCOL_FEE_RATE = 0;
export const GAUGED_PROTOCOL_FEE_RATE = 10_000;

// Soft-launch LP incentive program (Admin › LP Incentives, data/lp-incentives.json):
// an ungauged pool enrolled there keeps its configured fee share instead of 0,
// so the reconciler never undoes what the Admin page applied on-chain.
const LP_INCENTIVES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "lp-incentives.json");

/** pool address → protocol fee rate (bps) for active LP incentives; empty when unconfigured. */
export function readLpIncentiveRates(file = LP_INCENTIVES_FILE) {
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return new Map();
		throw error;
	}
	const rates = new Map();
	for (const pool of Object.values(raw?.pools ?? {})) {
		if (pool?.status !== "active") continue;
		rates.set(new PublicKey(pool.poolAddress).toBase58(), feeRate(pool.feeShareBps, `LP incentive fee share for ${pool.poolAddress}`));
	}
	return rates;
}

export function hasNativeGaugeReward(pool) {
	const bytes = (reward) => reward?.extension ? Uint8Array.from(reward.extension) : reward?.authority?.toBytes();
	const primary = bytes(pool.rewardInfos?.[1]);
	const secondary = bytes(pool.rewardInfos?.[2]);
	return Boolean(primary?.length === 32 && secondary?.length === 32 &&
		(primary[0] & 2) !== 0 && secondary.every((byte) => byte === 0));
}

const key = (value) => new PublicKey(value).toBase58();
const feeRate = (value, label) => {
	if (!Number.isInteger(value) || value < 0 || value > 10_000) {
		throw new Error(`Invalid ${label}: ${value}`);
	}
	return value;
};

export const gaugeAddressForPool = (programId, protocol, pool) =>
	PublicKey.findProgramAddressSync(
		[Buffer.from("gauge"), new PublicKey(protocol).toBuffer(), new PublicKey(pool).toBuffer()],
		new PublicKey(programId),
	)[0];

const validateGauge = (entry, pool) => {
	if (!entry.account.tokenMintA.equals(pool.account.tokenMintA) ||
		!entry.account.tokenMintB.equals(pool.account.tokenMintB)) {
		throw new Error(`Gauge ${key(entry.publicKey)} token mints do not match pool ${key(pool.publicKey)}`);
	}
	if (typeof entry.account.isActive !== "boolean") {
		throw new Error(`Gauge ${key(entry.publicKey)} has invalid active state`);
	}
};

/** Pure, fail-closed planning. Only active gauges receive future pool fees. */
export function planGaugeFeePolicy({ programId, protocol, dexConfig, config, pools, gauges, incentiveRates = new Map() }) {
	if (!Array.isArray(pools) || !Array.isArray(gauges)) {
		throw new Error("Complete pool and gauge account lists are required");
	}
	const configAddress = key(dexConfig);
	const poolByAddress = new Map();
	for (const pool of pools) {
		const address = key(pool.publicKey);
		if (poolByAddress.has(address)) throw new Error(`Duplicate pool ${address}`);
		key(pool.account.solvesConfig);
		poolByAddress.set(address, pool);
	}
	const scopedGauges = [];
	const gaugeByPool = new Map();
	const seenGauges = new Set();
	for (const gauge of gauges) {
		const address = key(gauge.publicKey);
		if (seenGauges.has(address)) throw new Error(`Duplicate gauge ${address}`);
		seenGauges.add(address);
		const poolAddress = key(gauge.account.poolAddress);
		// Gauge has no protocol field: the protocol-specific PDA is its scope.
		if (key(gaugeAddressForPool(programId, protocol, poolAddress)) !== address) continue;
		const pool = poolByAddress.get(poolAddress);
		if (!pool) throw new Error(`Gauge ${address} references an undiscovered DEX pool ${poolAddress}`);
		if (key(pool.account.solvesConfig) !== configAddress) continue;
		validateGauge(gauge, pool);
		if (gaugeByPool.has(poolAddress)) throw new Error(`Duplicate gauge for pool ${poolAddress}`);
		gaugeByPool.set(poolAddress, gauge);
		scopedGauges.push(gauge);
	}
	const defaultRate = feeRate(config.defaultProtocolFeeRate, "default protocol fee rate");
	const poolPolicies = [...poolByAddress.values()]
		.filter((pool) => key(pool.account.solvesConfig) === configAddress)
		.map((pool) => {
			const address = key(pool.publicKey);
			const gauge = gaugeByPool.get(address);
			const from = feeRate(pool.account.protocolFeeRate, `protocol fee rate for ${address}`);
			const to = gauge?.account.isActive
				? GAUGED_PROTOCOL_FEE_RATE
				: (incentiveRates.get(address) ?? UNGAUGED_PROTOCOL_FEE_RATE);
			return {
				pool: address, from, to,
				lpIncentive: incentiveRates.has(address) && !gauge?.account.isActive,
				gauge: gauge ? key(gauge.publicKey) : null,
				gaugeActive: gauge?.account.isActive ?? false,
				nativeReady: hasNativeGaugeReward(pool.account),
			};
		}).sort((a, b) => a.pool.localeCompare(b.pool));
	return {
		dexConfig: configAddress,
		defaultPolicy: { from: defaultRate, to: UNGAUGED_PROTOCOL_FEE_RATE },
		poolPolicies,
		changes: poolPolicies.filter((item) => item.from !== item.to),
		gauges: scopedGauges,
	};
}

/** A failed/partial RPC response is never interpreted as "no gauge". */
export async function readGaugeFeePolicySnapshot({ program, dexContext, dexConfig, protocol, incentiveRates = readLpIncentiveRates() }) {
	const [config, pools, gauges] = await Promise.all([
		dexContext.program.account.solvesConfig.fetch(dexConfig),
		dexContext.program.account.solve.all(),
		program.account.gauge.all(),
	]);
	const snapshot = { programId: program.programId, protocol, dexConfig, config, pools, gauges, incentiveRates };
	return { ...snapshot, plan: planGaugeFeePolicy(snapshot) };
}

/** Changes fee rates only: no fee collection, transfers, minting or epoch work. */
export async function reconcileGaugeFeePolicy({
	program, dexContext, dexConfig, protocol, wallet,
	provider = dexContext.provider, dryRun = true, log = () => {},
}) {
	const snapshot = await readGaugeFeePolicySnapshot({ program, dexContext, dexConfig, protocol });
	const { plan, config } = snapshot;
	if (!config.feeAuthority.equals(wallet.publicKey)) {
		throw new Error(`Keeper signer ${key(wallet.publicKey)} is not DEX fee authority ${key(config.feeAuthority)}`);
	}
	const signatures = [];
	const unmigrated = plan.poolPolicies.filter((item) => item.gaugeActive && !item.nativeReady);
	if (!dryRun && unmigrated.length) {
		throw new Error(`Native gauge migration required before fee-policy writes: ${unmigrated.map((item) => item.pool).join(", ")}`);
	}
	log("fee_policy_planned", {
		dryRun, dexConfig: plan.dexConfig, pools: plan.poolPolicies.length,
		gauges: plan.gauges.length, poolChanges: plan.changes.length,
		defaultFrom: plan.defaultPolicy.from, defaultTo: plan.defaultPolicy.to,
	});
	if (plan.defaultPolicy.from !== plan.defaultPolicy.to) {
		if (dryRun) log("would_set_default_protocol_fee_rate", plan.defaultPolicy);
		else {
			const instruction = await dexContext.program.methods
				.setDefaultProtocolFeeRate(plan.defaultPolicy.to)
				.accounts({ solvesConfig: dexConfig, feeAuthority: wallet.publicKey }).instruction();
			const signature = await provider.sendAndConfirm(new Transaction().add(instruction), [], { commitment: "confirmed" });
			const after = await dexContext.program.account.solvesConfig.fetch(dexConfig);
			if (after.defaultProtocolFeeRate !== plan.defaultPolicy.to) {
				throw new Error(`Default protocol fee rate verification failed after ${signature}`);
			}
			signatures.push({ action: "default_protocol_fee_rate_set", signature });
			log("default_protocol_fee_rate_set", { ...plan.defaultPolicy, signature });
		}
	}
	for (const change of plan.changes) {
		if (dryRun) {
			log("would_set_pool_protocol_fee_rate", change);
			continue;
		}
		const poolAddress = new PublicKey(change.pool);
		// Re-read the canonical gauge immediately before a write. In particular,
		// do not undo an Admin gauge+fee transaction using an old "no gauge" list.
		const pool = await dexContext.program.account.solve.fetch(poolAddress);
		if (key(pool.solvesConfig) !== key(dexConfig)) throw new Error(`Pool ${change.pool} changed DEX config`);
		const gaugeAddress = gaugeAddressForPool(program.programId, protocol, poolAddress);
		const gauge = await program.account.gauge.fetchNullable(gaugeAddress);
		if (gauge) {
			if (key(gauge.poolAddress) !== change.pool) throw new Error(`Gauge ${key(gaugeAddress)} pool mismatch`);
			validateGauge({ publicKey: gaugeAddress, account: gauge }, { publicKey: poolAddress, account: pool });
		}
		const target = gauge?.isActive
			? GAUGED_PROTOCOL_FEE_RATE
			: (snapshot.incentiveRates.get(change.pool) ?? UNGAUGED_PROTOCOL_FEE_RATE);
		if (target === GAUGED_PROTOCOL_FEE_RATE && !hasNativeGaugeReward(pool)) throw new Error(`Native gauge migration required for ${change.pool}`);
		if (pool.protocolFeeRate === target) {
			log("pool_fee_policy_already_current", { pool: change.pool, rate: target });
			continue;
		}
		const instruction = await dexContext.program.methods.setProtocolFeeRate(target)
			.accounts({ solvesConfig: dexConfig, solve: poolAddress, feeAuthority: wallet.publicKey }).instruction();
		const signature = await provider.sendAndConfirm(new Transaction().add(instruction), [], { commitment: "confirmed" });
		const after = await dexContext.program.account.solve.fetch(poolAddress);
		if (after.protocolFeeRate !== target) throw new Error(`Pool ${change.pool} fee rate verification failed after ${signature}`);
		signatures.push({ action: "pool_protocol_fee_rate_set", pool: change.pool, signature });
		log("pool_protocol_fee_rate_set", {
			pool: change.pool, from: pool.protocolFeeRate, to: target,
			gauge: gauge ? key(gaugeAddress) : null, signature,
		});
		if (target === UNGAUGED_PROTOCOL_FEE_RATE) {
			// Gauge creation can race between our existence check and transaction.
			// Repair that narrow window immediately instead of reporting success
			// with an existing gauge left at 0%. A read/write error fails loudly.
			const createdGauge = await program.account.gauge.fetchNullable(gaugeAddress);
			if (createdGauge?.isActive) {
				if (key(createdGauge.poolAddress) !== change.pool) throw new Error(`Gauge ${key(gaugeAddress)} pool mismatch`);
				validateGauge({ publicKey: gaugeAddress, account: createdGauge }, { publicKey: poolAddress, account: after });
				if (!hasNativeGaugeReward(after)) throw new Error(`Native gauge migration required for ${change.pool}`);
				const correction = await dexContext.program.methods.setProtocolFeeRate(GAUGED_PROTOCOL_FEE_RATE)
					.accounts({ solvesConfig: dexConfig, solve: poolAddress, feeAuthority: wallet.publicKey }).instruction();
				const correctionSignature = await provider.sendAndConfirm(new Transaction().add(correction), [], { commitment: "confirmed" });
				const corrected = await dexContext.program.account.solve.fetch(poolAddress);
				if (corrected.protocolFeeRate !== GAUGED_PROTOCOL_FEE_RATE) {
					throw new Error(`Pool ${change.pool} gauge-creation race repair failed after ${correctionSignature}`);
				}
				signatures.push({ action: "gauge_creation_race_repaired", pool: change.pool, signature: correctionSignature });
				log("gauge_creation_race_repaired", {
					pool: change.pool, gauge: key(gaugeAddress), to: GAUGED_PROTOCOL_FEE_RATE, signature: correctionSignature,
				});
			}
		}
	}
	return { plan, signatures, gauges: plan.gauges };
}
