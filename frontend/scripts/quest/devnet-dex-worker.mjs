import { createHash } from "node:crypto";
import {
	runVerifiedGenesisDevnetCycles,
	validateGenesisWorkerBounds,
} from "../../src/lib/genesis/devnetWorker.ts";
import { createFinalizedSolanaSource } from "../../src/lib/genesis/finalizedSource.ts";
import { withQuestDevnetStartup } from "./devnet-startup-adapter.mjs";

/**
 * Dormant bounded worker entry. Requires explicit, separately approved startup
 * inputs and factories. No CLI, default connection, timer or import-time network/database I/O.
 * The canonical startup adapter verifies and closes the same dedicated connection.
 */
export async function runQuestDevnetDexWorker({
	manifestJson,
	approvedManifestSha256,
	rpcUrl,
	openDatabase,
	campaignId,
	startSlot,
	decoderVersion,
	createRpc,
	createDecoder,
	maxCycles = 1,
	maxSlots = 32,
	collectInventory,
	clock,
}) {
	validateGenesisWorkerBounds(maxCycles, maxSlots, startSlot);
	if (
		typeof campaignId !== "string" ||
		!campaignId ||
		typeof decoderVersion !== "string" ||
		!decoderVersion ||
		typeof createRpc !== "function" ||
		typeof createDecoder !== "function"
	) {
		throw new TypeError(
			"Quest DEX worker requires explicit campaign, decoder and client factories.",
		);
	}
	let enteredWork = false;
	let workFinished = false;
	try {
		return await withQuestDevnetStartup({
			manifestJson,
			approvedManifestSha256,
			rpcUrl,
			openDatabase,
			...(collectInventory === undefined ? {} : { collectInventory }),
			...(clock === undefined ? {} : { clock }),
			async work({ connection, receipt }) {
				enteredWork = true;
				const manifest = JSON.parse(manifestJson);
				if (
					receipt.network !== "DEVNET" ||
					createHash("sha256").update(manifestJson).digest("hex") !==
						receipt.manifestSha256
				) {
					throw new Error("Quest DEX startup receipt does not match manifest.");
				}
				const rpc = await createRpc({ rpcUrl, receipt });
				if (
					typeof rpc?.getGenesisHash !== "function" ||
					typeof rpc.getSlot !== "function" ||
					typeof rpc.getBlocks !== "function" ||
					typeof rpc.getBlock !== "function" ||
					(await rpc.getGenesisHash()) !== manifest.genesisHash
				) {
					throw new Error("Quest DEX source is not the verified Devnet chain.");
				}
				const decoder = await createDecoder({
					campaignId,
					cluster: "devnet",
					programId: manifest.programs.dexProgram.address,
				});
				if (
					decoder?.programId !== manifest.programs.dexProgram.address ||
					decoder.version !== decoderVersion ||
					typeof decoder.decode !== "function"
				)
					throw new Error(
						"Quest DEX decoder does not match pinned worker identity.",
					);
				const source = createFinalizedSolanaSource(rpc);
				const finalizedSlot = source.finalizedSlot.bind(source);
				source.finalizedSlot = async () => {
					const slot = await finalizedSlot();
					if (!Number.isSafeInteger(slot) || slot < receipt.finalizedSlot)
						throw new Error("Quest DEX source finalized head regressed.");
					return slot;
				};
				const value = await runVerifiedGenesisDevnetCycles({
					connection,
					campaignId,
					startSlot,
					source,
					decoder,
					maxCycles,
					maxSlots,
				});
				workFinished = true;
				return value;
			},
		});
	} catch {
		// Startup/source failures are sanitized; the canonical adapter closes owned connections.
		return {
			receipt: null,
			value: {
				status: "paused",
				reason: workFinished
					? "CONNECTION_CLOSE_FAILED"
					: enteredWork
						? "SOURCE_REFUSED"
						: "STARTUP_REFUSED",
			},
		};
	}
}
