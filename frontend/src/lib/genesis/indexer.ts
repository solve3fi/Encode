import type { GenesisChainEventRecord } from "./eventFingerprint";

export type FinalizedBlock<Transaction> = {
	slot: number;
	blockTimeSeconds: number;
	transactions: readonly Transaction[];
};

export type FinalizedSource<Transaction> = {
	finalizedSlot(): Promise<number>;
	readRange(
		startSlot: number,
		endSlot: number,
	): Promise<readonly FinalizedBlock<Transaction>[]>;
};

/** The decoder must fail closed for any relevant instruction it cannot verify. */
export type VerifiedGenesisDecoder<Transaction> = {
	programId: string;
	version: string;
	decode(
		block: FinalizedBlock<Transaction>,
	): Promise<readonly GenesisChainEventRecord[]>;
};

export type IndexedGenesisEvent = {
	record: GenesisChainEventRecord;
	eventSha256: string;
	decoderVersion: string;
};

export type GenesisLedger = {
	readNextSlot(
		campaignId: string,
		programId: string,
		decoderVersion: string,
	): Promise<number>;
	commitRange(input: {
		campaignId: string;
		programId: string;
		decoderVersion: string;
		startSlot: number;
		nextSlot: number;
		events: readonly IndexedGenesisEvent[];
	}): Promise<{ inserted: number; duplicates: number }>;
};

/** One bounded finalized range. No progress, XP, or rewards are calculated. */
export async function indexGenesisRange<Transaction>(input: {
	campaignId: string;
	cluster: GenesisChainEventRecord["cluster"];
	source: FinalizedSource<Transaction>;
	decoder: VerifiedGenesisDecoder<Transaction>;
	ledger: GenesisLedger;
	fingerprint: (record: GenesisChainEventRecord) => { eventSha256: string };
	maxSlots?: number;
}) {
	const { campaignId, cluster, source, decoder, ledger, fingerprint } = input;
	const maxSlots = input.maxSlots ?? 32;
	if (!Number.isSafeInteger(maxSlots) || maxSlots < 1 || maxSlots > 512) {
		throw new RangeError("Invalid Genesis indexer batch size.");
	}
	const startSlot = await ledger.readNextSlot(
		campaignId,
		decoder.programId,
		decoder.version,
	);
	const finalizedSlot = await source.finalizedSlot();
	if (
		!Number.isSafeInteger(startSlot) ||
		startSlot < 0 ||
		!Number.isSafeInteger(finalizedSlot)
	) {
		throw new Error("Invalid Genesis cursor or finalized slot.");
	}
	if (startSlot > finalizedSlot) {
		return { startSlot, nextSlot: startSlot, inserted: 0, duplicates: 0 };
	}
	const endSlot = Math.min(finalizedSlot, startSlot + maxSlots - 1);
	const blocks = await source.readRange(startSlot, endSlot);
	const seenSlots = new Set<number>();
	const events: IndexedGenesisEvent[] = [];
	for (const block of blocks) {
		if (
			!Number.isSafeInteger(block.slot) ||
			block.slot < startSlot ||
			block.slot > endSlot ||
			seenSlots.has(block.slot) ||
			!Number.isSafeInteger(block.blockTimeSeconds) ||
			block.blockTimeSeconds < 0
		) {
			throw new Error("Invalid or repeated finalized block in Genesis range.");
		}
		seenSlots.add(block.slot);
		for (const record of await decoder.decode(block)) {
			if (
				record.campaignId !== campaignId ||
				record.cluster !== cluster ||
				record.slot !== block.slot ||
				record.blockTimeSeconds !== block.blockTimeSeconds
			) {
				throw new Error(
					"Genesis decoder returned an event outside its verified block.",
				);
			}
			events.push({
				record,
				eventSha256: fingerprint(record).eventSha256,
				decoderVersion: decoder.version,
			});
		}
	}
	const nextSlot = endSlot + 1;
	const result = await ledger.commitRange({
		campaignId,
		programId: decoder.programId,
		decoderVersion: decoder.version,
		startSlot,
		nextSlot,
		events,
	});
	return { startSlot, nextSlot, ...result };
}
