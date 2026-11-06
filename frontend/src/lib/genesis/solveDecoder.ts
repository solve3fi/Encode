import type { VersionedTransactionResponse } from "@solana/web3.js";
import type { GenesisChainEventRecord } from "./eventFingerprint";
import type { VerifiedGenesisDecoder } from "./indexer";
import { decodePositionTransactionsWithSwaps } from "./positionDecoder.ts";
import { decodeSwapTransactionsWithPositions } from "./swapDecoder.ts";

/**
 * Bump before changing any emitted event identity or payload in a deployed indexer.
 * v2: swaps of the Apache build (no events) are decoded from exact token transfers.
 */
export const SOLVE_DIRECT_DECODER_VERSION = "solve-direct-2";

/** A strict decoder for the supported direct Solve swap and position instructions. */
export function createVerifiedSolveDecoder(input: {
	campaignId: string;
	cluster: GenesisChainEventRecord["cluster"];
	programId: string;
}): VerifiedGenesisDecoder<VersionedTransactionResponse> {
	if (!input.campaignId || !input.programId)
		throw new Error("Genesis decoder requires campaign and program IDs.");
	return {
		programId: input.programId,
		version: SOLVE_DIRECT_DECODER_VERSION,
		async decode(block) {
			const records: GenesisChainEventRecord[] = [];
			const identities = new Set<string>();
			for (const transaction of block.transactions) {
				const { message } = transaction.transaction;
				const meta = transaction.meta;
				if (meta) {
					const keys = [
						...message.staticAccountKeys,
						...(meta.loadedAddresses?.writable ?? []),
						...(meta.loadedAddresses?.readonly ?? []),
					].map((key) => key.toBase58());
					for (const group of meta.innerInstructions ?? []) {
						for (const ix of group.instructions) {
							const program = keys[ix.programIdIndex];
							if (!program)
								throw new Error(
									"Solve inner instruction program is unavailable.",
								);
							if (program === input.programId)
								throw new Error("Solve CPI attribution is unsupported.");
						}
					}
					if (
						meta.logMessages?.some((log) => {
							const depth =
								/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(log);
							return depth?.[1] === input.programId && Number(depth[2]) > 1;
						})
					) {
						throw new Error("Solve CPI attribution is unsupported.");
					}
				}
				const args = {
					...input,
					slot: block.slot,
					blockTimeSeconds: block.blockTimeSeconds,
					transactions: [transaction],
				};
				const events = [
					...decodeSwapTransactionsWithPositions(args),
					...decodePositionTransactionsWithSwaps(args),
				].sort(
					(a, b) =>
						a.instructionIndex - b.instructionIndex ||
						a.eventIndex - b.eventIndex,
				);
				for (const event of events) {
					const identity = [
						event.signature,
						event.instructionIndex,
						event.eventIndex,
					].join(":");
					if (identities.has(identity))
						throw new Error("Duplicate verified Solve event identity.");
					identities.add(identity);
					records.push(event);
				}
			}
			return records;
		},
	};
}
