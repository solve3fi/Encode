import fs from "node:fs";
import { pathToFileURL } from "node:url";
import anchor from "@coral-xyz/anchor";
import { buildSolveClient, SolveContext } from "@solve3fi/sdk";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountIdempotentInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	ComputeBudgetProgram,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
} from "@solana/web3.js";
import idl from "../src/configs/vesolve.json" with { type: "json" };
import { GAUGED_PROTOCOL_FEE_RATE, reconcileGaugeFeePolicy } from "./lib/gauge-fee-policy.mjs";
import { createResilientConnection } from "./lib/resilient-rpc.mjs";

const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const DEFAULT_REWARD_MINT = "DvGitpT8Qujq6sxXoq7M1vueGf97dGVpoPWY4ifYHCHu";
const DEX_PROGRAM_ID = new PublicKey(
	"HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK",
);
const DEX_CONFIG = new PublicKey(
	"F2QtwRjDpdVR25n3ZMWpmAKdMK21LDdi3pTGUTc8ELef",
);
// No/inactive gauge: LP trading fees only. Active native gauge: fees to
// voters; range-aware, liquidity-weighted emissions to the pool's LPs.
const BRIBE_FEE_RATE = GAUGED_PROTOCOL_FEE_RATE;

export async function buildNativePoolFeeRoutingTransaction({ program, dexProgramId, dexConfig, protocol, wallet, gaugeAddress, poolAddress, poolData, epoch }) {
	const vault = PublicKey.findProgramAddressSync([Buffer.from("vault"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8), gaugeAddress.toBuffer()], program.programId)[0];
	const ix = await program.methods.routePoolFees(new anchor.BN(epoch)).accounts({
		admin: wallet.publicKey, protocol, gauge: gaugeAddress, solvesConfig: dexConfig, pool: poolAddress, vault,
		tokenMintA: poolData.tokenMintA, tokenMintB: poolData.tokenMintB,
		tokenVaultA: poolData.tokenVaultA, tokenVaultB: poolData.tokenVaultB,
		vaultTokenAccountA: getAssociatedTokenAddressSync(poolData.tokenMintA, vault, true),
		vaultTokenAccountB: getAssociatedTokenAddressSync(poolData.tokenMintB, vault, true),
		solveProgram: dexProgramId, tokenProgram: TOKEN_PROGRAM_ID,
		associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
	}).instruction();
	return new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }), ix);
}

/** Initialize both staging and gauge ATAs atomically with collection/deposit. */
export async function buildPoolFeeRoutingTransaction({
	program, dexContext, dexConfig, protocol, wallet, gaugeAddress, poolAddress,
	poolData, epoch,
}) {
	const amountA = poolData.protocolFeeOwedA;
	const amountB = poolData.protocolFeeOwedB;
	const userTokenAccountA = getAssociatedTokenAddressSync(poolData.tokenMintA, wallet.publicKey);
	const userTokenAccountB = getAssociatedTokenAddressSync(poolData.tokenMintB, wallet.publicKey);
	const vault = PublicKey.findProgramAddressSync([
		Buffer.from("vault"), new anchor.BN(epoch).toArrayLike(Buffer, "le", 8), gaugeAddress.toBuffer(),
	], program.programId)[0];
	const vaultTokenAccountA = getAssociatedTokenAddressSync(poolData.tokenMintA, vault, true);
	const vaultTokenAccountB = getAssociatedTokenAddressSync(poolData.tokenMintB, vault, true);
	// ATAs can be created for an off-curve vault PDA before that PDA's account
	// exists. Idempotent creation handles both pre-existing ATAs and races.
	const setupInstructions = [
		[poolData.tokenMintA, wallet.publicKey, userTokenAccountA],
		[poolData.tokenMintB, wallet.publicKey, userTokenAccountB],
		[poolData.tokenMintA, vault, vaultTokenAccountA],
		[poolData.tokenMintB, vault, vaultTokenAccountB],
	].map(([mint, owner, ata]) => createAssociatedTokenAccountIdempotentInstruction(
		wallet.publicKey, ata, owner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
	));
	const collectIx = await dexContext.program.methods.collectProtocolFees().accounts({
		solvesConfig: dexConfig, solve: poolAddress,
		collectProtocolFeesAuthority: wallet.publicKey,
		tokenVaultA: poolData.tokenVaultA, tokenVaultB: poolData.tokenVaultB,
		tokenDestinationA: userTokenAccountA, tokenDestinationB: userTokenAccountB,
		tokenProgram: TOKEN_PROGRAM_ID,
	}).instruction();
	const distributeIx = await program.methods.distributePoolReward(amountA, amountB).accounts({
		admin: wallet.publicKey, protocol, gauge: gaugeAddress, vault,
		tokenMintA: poolData.tokenMintA, userTokenAccountA, vaultTokenAccountA,
		tokenMintB: poolData.tokenMintB, userTokenAccountB, vaultTokenAccountB,
		systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
		associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
	}).instruction();
	return new Transaction().add(...setupInstructions, collectIx, distributeIx);
}

export async function assertFeeRoutingEpoch(fetchProtocol, expectedEpoch) {
	const state = await fetchProtocol();
	const actualEpoch = state.currentEpoch.toNumber();
	if (actualEpoch !== expectedEpoch) {
		throw new Error(`Fee-routing epoch changed from ${expectedEpoch} to ${actualEpoch}; refusing to reassign pending fees to another epoch`);
	}
	return state;
}

/** Route healthy pools even if another fails, but never roll over an incomplete sweep. */
export async function routeFeeBatchForEpoch({ gauges, epoch, routeGauge, fetchProtocol, log }) {
	const failures = [];
	await assertFeeRoutingEpoch(fetchProtocol, epoch);
	for (const item of gauges) {
		await assertFeeRoutingEpoch(fetchProtocol, epoch);
		try {
			await routeGauge(item, epoch);
		} catch (error) {
			failures.push(error);
			log("pool_fee_routing_failed", {
				epoch, gauge: item.symbol, error: error instanceof Error ? error.message : String(error),
			});
		}
		// A concurrent rollover is not a recoverable per-pool failure: do not
		// send the remainder of the batch to a newer epoch's voters.
		await assertFeeRoutingEpoch(fetchProtocol, epoch);
	}
	if (failures.length) {
		log("epoch_rollover_blocked", { epoch, failedPools: failures.length, reason: "incomplete_fee_sweep" });
		throw new AggregateError(failures, `Epoch ${epoch} fee sweep incomplete; rollover blocked for ${failures.length} failed pool(s)`);
	}
	return assertFeeRoutingEpoch(fetchProtocol, epoch);
}

export async function runKeeper() {
const dryRun = process.argv.includes("--dry-run");
const feePolicyOnly = process.argv.includes("--fee-policy-only");
const keyPath =
	process.env.SOLVE3_KEEPER_KEYPAIR ?? process.env.SOLVE3_DEVNET_KEYPAIR;
if (!keyPath) {
	throw new Error(
		"SOLVE3_KEEPER_KEYPAIR is required (SOLVE3_DEVNET_KEYPAIR is also supported)",
	);
}

const log = (action, details = {}) => {
	console.log(
		JSON.stringify({ timestamp: new Date().toISOString(), action, ...details }),
	);
};

const loadKeypair = (path) => {
	const bytes = JSON.parse(fs.readFileSync(path, "utf8"));
	return Keypair.fromSecretKey(Uint8Array.from(bytes));
};

const parseGauges = (discoveredGauges) => {
	if (!process.env.SOLVE3_ACTIVE_GAUGES) {
		return discoveredGauges.filter((item) => item.account.isActive).map((item) => ({
			symbol: item.publicKey.toBase58(), address: item.publicKey,
		}));
	}

	const seen = new Set();
	return process.env.SOLVE3_ACTIVE_GAUGES.split(",").map((entry) => {
		const [symbol, address] = entry.trim().split(":");
		if (!symbol || !address) {
			throw new Error(
				"SOLVE3_ACTIVE_GAUGES must contain comma-separated SYMBOL:ADDRESS entries",
			);
		}
		const matched = discoveredGauges.find((item) => item.publicKey.toBase58() === address);
		if (!matched) throw new Error(`Configured gauge ${address} is not a validated gauge for this protocol and DEX config`);
		if (seen.has(address)) throw new Error(`Duplicate configured gauge ${address}`);
		seen.add(address);
		return { symbol, address: new PublicKey(address) };
	});
};

const getChainTime = async (connection) => {
	const slot = await connection.getSlot("confirmed");
	const blockTime = await connection.getBlockTime(slot);
	if (blockTime === null)
		throw new Error(
			`Solana did not return block time for confirmed slot ${slot}`,
		);
	return { slot, unixTime: blockTime };
};

const payer = loadKeypair(keyPath);
const wallet = new anchor.Wallet(payer);
const connection = createResilientConnection(
	process.env.SOLVE3_RPC_URL ?? process.env.SOLVE3_DEVNET_RPC ?? DEFAULT_RPC,
	"confirmed",
);
const provider = new anchor.AnchorProvider(connection, wallet, {
	commitment: "confirmed",
});
const program = new anchor.Program(idl, provider);
const dexContext = SolveContext.from(connection, wallet, DEX_PROGRAM_ID);
const dexClient = buildSolveClient(dexContext);
const programId = program.programId;
const rewardMint = new PublicKey(
	process.env.SOLVE3_REWARD_MINT ?? DEFAULT_REWARD_MINT,
);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, programId)[0];
const u64 = (value) => new anchor.BN(value).toArrayLike(Buffer, "le", 8);
const protocol = pda([Buffer.from("protocol")]);

const fetchProtocol = () => program.account.protocol.fetch(protocol);
const epochPda = (epoch) => pda([Buffer.from("epoch_data"), u64(epoch)]);
const epochEmissionPda = (epoch) =>
	pda([Buffer.from("epoch_emission"), u64(epoch)]);

const routePoolFeesToGauge = async (item, epoch) => {
	const gaugeState = await program.account.gauge.fetchNullable(item.address);
	if (!gaugeState?.isActive) {
		return;
	}

	const pool = await dexClient.getPool(gaugeState.poolAddress, { maxAge: 0 });
	const poolData = pool.getData();
	const amountA = poolData.protocolFeeOwedA;
	const amountB = poolData.protocolFeeOwedB;
	if (amountA.isZero() && amountB.isZero()) {
		return;
	}

	if (poolData.protocolFeeRate !== BRIBE_FEE_RATE) {
		if (dryRun) {
			log("would_route_after_fee_policy_update", {
				epoch,
				gauge: item.symbol,
				pool: gaugeState.poolAddress.toBase58(),
				from: poolData.protocolFeeRate,
				to: BRIBE_FEE_RATE,
			});
			return;
		}
		throw new Error(
			`${item.symbol} pool ${gaugeState.poolAddress.toBase58()} is configured for ${poolData.protocolFeeRate / 100}% protocol fees; expected ${BRIBE_FEE_RATE / 100}% gauge routing`,
		);
	}

	if (dryRun) {
		log("would_route_pool_fees", {
			epoch,
			gauge: item.symbol,
			pool: gaugeState.poolAddress.toBase58(),
			tokenAAmount: amountA.toString(),
			tokenBAmount: amountB.toString(),
			idempotentTokenAccountInitializations: 2,
		});
		return;
	}

	const transaction = await buildNativePoolFeeRoutingTransaction({
		program, dexProgramId: DEX_PROGRAM_ID, dexConfig: DEX_CONFIG, protocol, wallet,
		gaugeAddress: item.address, poolAddress: gaugeState.poolAddress, poolData, epoch,
	});
	await assertFeeRoutingEpoch(fetchProtocol, epoch);
	const signature = await provider.sendAndConfirm(
		transaction,
		[],
		{ commitment: "confirmed" },
	);
	log("pool_fees_routed", {
		epoch,
		gauge: item.symbol,
		pool: gaugeState.poolAddress.toBase58(),
		tokenAAmount: amountA.toString(),
		tokenBAmount: amountB.toString(),
		signature,
	});
};

const routePoolFees = (epoch) => routeFeeBatchForEpoch({
	gauges, epoch, routeGauge: routePoolFeesToGauge, fetchProtocol, log,
});

// An environment override must never send this devnet keeper to mainnet.
const genesisHash = await connection.getGenesisHash();
if (genesisHash !== DEVNET_GENESIS_HASH) {
	throw new Error(`Refusing devnet keeper on unexpected cluster genesis ${genesisHash}`);
}
let protocolState = await fetchProtocol();
if (!protocolState.admin.equals(wallet.publicKey)) {
	throw new Error(
		`Keeper signer ${wallet.publicKey.toBase58()} is not protocol admin ${protocolState.admin.toBase58()}`,
	);
}

const feePolicy = await reconcileGaugeFeePolicy({
	program, dexContext, dexConfig: DEX_CONFIG, protocol, wallet, dryRun, log,
});
if (feePolicyOnly) {
	log("fee_policy_only_complete", { dryRun, transactions: feePolicy.signatures.length });
	process.exit(0);
}
// An explicit allowlist limits routing/funding, never fee policy discovery.
const gauges = parseGauges(feePolicy.gauges);

const initialEpoch = protocolState.currentEpoch.toNumber();
let { slot, unixTime: chainTime } = await getChainTime(connection);
let epochEnd =
	protocolState.epochStartTime.toNumber() +
	protocolState.epochResetTime.toNumber();

log("keeper_started", {
	dryRun,
	slot,
	chainTime,
	currentEpoch: initialEpoch,
	epochEnd,
	admin: wallet.publicKey.toBase58(),
});

// Sweep each pool's protocol-fee counters into its own gauge vault before any
// epoch rollover. The vault is keyed by the current epoch, so votes in that
// epoch receive the fees generated during that epoch.
protocolState = await routePoolFees(initialEpoch);
({ slot, unixTime: chainTime } = await getChainTime(connection));
epochEnd = protocolState.epochStartTime.toNumber() + protocolState.epochResetTime.toNumber();

if (chainTime >= epochEnd) {
	// Refetch immediately before sending so two keepers racing at the boundary safely converge.
	protocolState = await assertFeeRoutingEpoch(fetchProtocol, initialEpoch);
	({ slot, unixTime: chainTime } = await getChainTime(connection));
	epochEnd =
		protocolState.epochStartTime.toNumber() +
		protocolState.epochResetTime.toNumber();

	if (chainTime >= epochEnd) {
		const nextEpoch = protocolState.currentEpoch.toNumber() + 1;
		if (dryRun) {
			log("would_rollover_epoch", { nextEpoch, slot, chainTime, epochEnd });
			process.exit(0);
		}

		try {
			const signature = await program.methods
				.updateEpoch()
				.accounts({
					caller: wallet.publicKey,
					protocol,
					epoch: epochPda(nextEpoch),
					systemProgram: SystemProgram.programId,
				})
				.rpc({ commitment: "confirmed" });
			log("epoch_rolled_over", { epoch: nextEpoch, signature });
		} catch (error) {
			// A concurrent keeper may have won the race. Only accept the error if state advanced.
			const afterRace = await fetchProtocol();
			if (afterRace.currentEpoch.toNumber() !== nextEpoch)
				throw error;
			log("epoch_already_rolled_over", {
				epoch: afterRace.currentEpoch.toNumber(),
			});
		}
	}
}

protocolState = await fetchProtocol();
const emissionEpoch = protocolState.currentEpoch.toNumber();
if (emissionEpoch < 1) {
	log("nothing_to_reconcile", {
		reason: "no_completed_voting_epoch",
		currentEpoch: emissionEpoch,
	});
	process.exit(0);
}

const votingEpochNumber = emissionEpoch - 1;
const votingEpochAddress = epochPda(votingEpochNumber);
const votingEpochState = await program.account.epoch.fetch(votingEpochAddress);
const epochEmission = epochEmissionPda(emissionEpoch);
const developerWallet = protocolState.admin;
const developerTokenAccount = getAssociatedTokenAddressSync(
	rewardMint,
	developerWallet,
);

if (!(await connection.getAccountInfo(epochEmission, "confirmed"))) {
	if (dryRun) {
		log("would_initialize_emission", {
			emissionEpoch,
			votingEpoch: votingEpochNumber,
		});
	} else {
		const signature = await program.methods
			.initializeEpochEmission(new anchor.BN(emissionEpoch))
			.accounts({
				caller: wallet.publicKey,
				protocol,
				votingEpoch: votingEpochAddress,
				epochEmission,
				developerWallet,
				tokenMint: rewardMint,
				developerTokenAccount,
				tokenProgram: TOKEN_PROGRAM_ID,
				associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				systemProgram: SystemProgram.programId,
			})
			.rpc({ commitment: "confirmed" });
		log("emission_initialized", {
			emissionEpoch,
			votingEpoch: votingEpochNumber,
			signature,
		});
	}
} else {
	log("emission_already_initialized", { emissionEpoch });
}

const totalVotingPower = votingEpochState.totalVotingPower.toString();
if (votingEpochState.totalVotingPower.isZero()) {
	log("gauge_funding_skipped", {
		emissionEpoch,
		reason: "zero_total_voting_power",
	});
	process.exit(0);
}

for (const item of gauges) {
	const gaugeVote = votingEpochState.gaugeWeights.find((entry) =>
		entry.gauge.equals(item.address),
	);
	if (!gaugeVote || gaugeVote.weight.isZero()) {
		log("gauge_funding_skipped", {
			emissionEpoch,
			gauge: item.symbol,
			reason: "no_final_vote_weight",
		});
		continue;
	}

	const gaugeState = await program.account.gauge.fetchNullable(item.address);
	if (!gaugeState?.isActive) {
		log("gauge_funding_skipped", {
			emissionEpoch,
			gauge: item.symbol,
			reason: "inactive_gauge",
		});
		continue;
	}

	const nativeGauge = pda([
		Buffer.from("native_gauge"),
		item.address.toBuffer(),
	]);
	const rewardState =
		await program.account.nativeGauge.fetchNullable(nativeGauge);
	if (!rewardState) throw new Error(`Native gauge migration required for ${item.address}`);
	const rewardVault = rewardState.rewardVault;
	if (rewardState?.lastFundedEpoch.toNumber() === emissionEpoch) {
		log("gauge_already_funded", { emissionEpoch, gauge: item.symbol });
		continue;
	}

	if (dryRun) {
		log("would_fund_gauge", {
			emissionEpoch,
			gauge: item.symbol,
			weight: gaugeVote.weight.toString(),
			totalVotingPower,
		});
		continue;
	}

	const signature = await program.methods
		.fundNativeGauge(new anchor.BN(emissionEpoch))
		.accounts({
			caller: wallet.publicKey,
			protocol,
			votingEpoch: votingEpochAddress,
			epochEmission,
			gauge: item.address,
			nativeGauge,
			pool: gaugeState.poolAddress,
			rewardMint,
			rewardVault,
			solveProgram: DEX_PROGRAM_ID,
			tokenProgram: TOKEN_PROGRAM_ID,
			systemProgram: SystemProgram.programId,
		})
		.rpc({ commitment: "confirmed" });
	log("gauge_funded", {
		emissionEpoch,
		gauge: item.symbol,
		weight: gaugeVote.weight.toString(),
		totalVotingPower,
		signature,
	});
}

log("keeper_complete", { emissionEpoch });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await runKeeper();
}
