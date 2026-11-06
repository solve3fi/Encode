// Devnet swap indexer worker. Reads finalized swap transactions of the DEX program, writes them to
// the Genesis ledger through the existing verified engine (index, then reconcile), and stores a
// TEST USD valuation for each swap. It awards nothing and exposes no route; the backend reads the
// result through a separate read-only role.
//
//   QUEST_INDEXER_DB_URL   login role with only the ledger privileges this worker needs
//   QUEST_DEVNET_RPC_URL   HTTPS Devnet RPC
//   QUEST_SWAP_PROGRAM_ID  the DEX (Solve) program
//   QUEST_SWAP_CAMPAIGN_ID the seeded campaign (see swap-seed.mjs)
//   QUEST_ENVIRONMENT_ID   must equal the database identity row
//   QUEST_VE_PROGRAM_ID    optional: the ve (veSOLV3) program. When set, the worker also records each epoch's
//                          votes for Voting XP (read from chain state; never blocks swap indexing)
//   QUEST_VOTE_INTERVAL_SECONDS  how often votes are read (default 120, minimum 30)
import { Connection, PublicKey } from "@solana/web3.js";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { runVerifiedGenesisDevnetCycles } from "../src/lib/genesis/devnetWorker.ts";
import { createVerifiedSolveDecoder } from "../src/lib/genesis/solveDecoder.ts";
import {
	createProgramTransactionSource,
	decodabilityCheck,
} from "../scripts/quest/devnet-swap-source.mjs";
import { runLpValuations } from "../scripts/quest/devnet-lp-valuation.mjs";
import { runVoteObservations } from "../scripts/quest/devnet-vote-source.mjs";
import { runPoolTickSamples } from "../scripts/quest/devnet-pool-ticks.mjs";
import { devnetLpPolicy } from "../scripts/quest/devnet-swap-progress-config.mjs";
import {
	parsePoolMints,
	runSwapValuations,
} from "../scripts/quest/devnet-swap-valuation.mjs";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEVNET_USDC_MINT = "FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up";

function singleConnectionPool(client) {
	let leased = false;
	return {
		async connect() {
			if (leased) throw new Error("Dedicated connection is already leased.");
			leased = true;
			return {
				query: client.query.bind(client),
				release() {
					leased = false;
				},
			};
		},
	};
}

/** One bounded round: index and reconcile until idle, paused or out of time. */
export async function runSwapWorkerRound({
	client,
	connection,
	campaignId,
	programId,
	usdcMint = DEVNET_USDC_MINT,
	usdcDecimals = 6,
	maxSlots = 512,
	budgetMs = 45_000,
	paceMs = 150,
	log,
	now = () => Date.now(),
}) {
	const decoder = createVerifiedSolveDecoder({
		campaignId,
		cluster: "devnet",
		programId,
	});
	const cursor = (
		await client.query(
			`SELECT reconciliation_start_slot::text AS start_slot, reconciled_through_slot::text AS reconciled
			 FROM genesis.indexer_cursors WHERE campaign_id = $1 AND program_id = $2 AND decoder_version = $3`,
			[campaignId, programId, decoder.version],
		)
	).rows[0];
	if (!cursor || cursor.start_slot === null)
		throw new Error("Swap campaign cursor is missing; run the seed first.");
	const startSlot = Number(cursor.start_slot);
	const floor =
		cursor.reconciled === null ? startSlot : Number(cursor.reconciled) + 1;
	const source = createProgramTransactionSource({
		connection,
		programId,
		PublicKey,
		canDecode: decodabilityCheck(decoder),
		paceMs,
	});
	const primed = await source.prime(floor);
	const mintCache = new Map();
	const resolvePoolMints = async (address) => {
		if (mintCache.has(address)) return mintCache.get(address);
		const info = await connection.getAccountInfo(new PublicKey(address), "finalized");
		if (!info || info.owner.toBase58() !== programId)
			throw new Error("Pool account is unavailable.");
		const mints = parsePoolMints(info.data, PublicKey);
		mintCache.set(address, mints);
		return mints;
	};
	const pool = singleConnectionPool(client);
	const totals = { indexed: 0, reconciled: 0, valued: 0, unresolved: 0, lpValued: 0, lpUnresolved: 0, cycles: 0 };
	let last = null;
	const started = now();
	while (now() - started < budgetMs) {
		last = await runVerifiedGenesisDevnetCycles({
			connection: client,
			campaignId,
			startSlot,
			source,
			decoder,
			maxCycles: 1,
			maxSlots,
		});
		totals.cycles += last.cyclesCompleted;
		totals.indexed += last.indexedEvents;
		totals.reconciled += last.reconciledEvents;
		// Valuations are written before the reconciliation watermark can cover these events,
		// so readers never see an unvalued swap inside a published prefix.
		const valued = await runSwapValuations({
			pool,
			campaignId,
			resolvePoolMints,
			usdcMint,
			usdcDecimals,
		});
		totals.valued += valued.valued;
		totals.unresolved += valued.unresolved;
		// Liquidity events get a running position value the same way (devUSDC leg, test policy).
		// It must never stop swap indexing: a failure here leaves LP progress unavailable and is retried.
		try {
			const lpValued = await runLpValuations({
				pool,
				campaignId,
				resolvePoolMints,
				usdcMint,
				usdcDecimals,
			});
			totals.lpValued += lpValued.valued;
			totals.lpUnresolved += lpValued.unresolved;
		} catch (error) {
			totals.lpFailed = (totals.lpFailed ?? 0) + 1;
			log?.({
				action: "lp_valuation_failed",
				error: error instanceof Error ? error.message.slice(0, 160) : "unknown",
			});
		}
		if (last.status !== "batch_complete") break;
	}
	const summary = {
		action: "swap_worker_round",
		status: last?.status ?? "none",
		reason: last?.reason ?? null,
		cursor: last?.cursor ?? null,
		primedSignatures: primed.signatures,
		...totals,
		source: source.stats(),
	};
	log?.(summary);
	return summary;
}

async function main() {
	const need = (name) => {
		const value = process.env[name];
		if (!value) throw new Error(`Missing required setting ${name}`);
		return value;
	};
	const rpc = need("QUEST_DEVNET_RPC_URL");
	if (new URL(rpc).protocol !== "https:") throw new Error("RPC must use HTTPS");
	const programId = need("QUEST_SWAP_PROGRAM_ID");
	new PublicKey(programId);
	const campaignId = need("QUEST_SWAP_CAMPAIGN_ID");
	const interval = Math.min(
		600,
		Math.max(15, Number(process.env.QUEST_SWAP_INTERVAL_SECONDS ?? 60)),
	);
	const veProgramId = process.env.QUEST_VE_PROGRAM_ID?.trim() || null;
	if (veProgramId) new PublicKey(veProgramId);
	const voteInterval =
		Math.max(30, Number(process.env.QUEST_VOTE_INTERVAL_SECONDS ?? 120)) * 1000;
	let lastVoteRun = 0;
	const lpPolicy = devnetLpPolicy();
	const connection = new Connection(rpc, { commitment: "finalized" });
	if ((await connection.getGenesisHash()) !== DEVNET_GENESIS)
		throw new Error("RPC is not Devnet");
	const log = (value) =>
		console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...value }));
	let stopping = false;
	for (const signal of ["SIGTERM", "SIGINT"])
		process.on(signal, () => {
			stopping = true;
		});
	while (!stopping) {
		const client = new pg.Client({
			connectionString: need("QUEST_INDEXER_DB_URL"),
			statement_timeout: 20_000,
		});
		try {
			await client.connect();
			const identity = (
				await client.query(
					"SELECT environment_id::text AS id FROM quest.environment_identity WHERE singleton = true",
				)
			).rows[0];
			if (identity?.id !== need("QUEST_ENVIRONMENT_ID"))
				throw new Error("Database environment differs");
			try {
				await runSwapWorkerRound({
					client,
					connection,
					campaignId,
					programId,
					maxSlots: Math.min(512, Number(process.env.QUEST_SWAP_MAX_SLOTS ?? 512)),
					log,
				});
			} catch (error) {
				log({
					action: "swap_worker_failed",
					error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
				});
			}
			// Pool price samples for range-aware LP quests: a separate source too, so a failure here
			// never stops swap indexing or votes.
			if (lpPolicy.requireInRange) {
				try {
					await runPoolTickSamples({
						client,
						connection,
						programId,
						PublicKey,
						pools: lpPolicy.featuredPools,
						log,
					});
				} catch (error) {
					log({
						action: "pool_tick_round_failed",
						error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
					});
				}
			}
			// Votes are a separate source. A failure here never affects swap indexing, and a swap
			// failure never stops votes from being recorded.
			if (veProgramId && Date.now() - lastVoteRun >= voteInterval) {
				try {
					await runVoteObservations({
						client,
						connection,
						programId: veProgramId,
						PublicKey,
						log,
					});
					lastVoteRun = Date.now();
				} catch (error) {
					log({
						action: "vote_observation_failed",
						error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
					});
				}
			}
		} catch (error) {
			log({
				action: "swap_worker_failed",
				error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
			});
		} finally {
			await client.end().catch(() => {});
		}
		for (let waited = 0; waited < interval && !stopping; waited++)
			await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	await main();
