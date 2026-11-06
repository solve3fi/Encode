import type { GenesisChainEventRecord } from "./eventFingerprint";
import type { FinalizedSource, VerifiedGenesisDecoder } from "./indexer";

export type StoredGenesisEvent = {
	cluster: GenesisChainEventRecord["cluster"];
	signature: string;
	instructionIndex: number;
	eventIndex: number;
	slot: number;
	blockTimeSeconds: number;
	decoderVersion: string;
	eventSha256: string;
};

export type GenesisReconciliationSnapshot = {
	nextSlot: number;
	events: readonly StoredGenesisEvent[];
	openConflictCount: number;
};

export type GenesisReconciliationReader = {
	readSnapshot(input: {
		campaignId: string;
		cluster: GenesisChainEventRecord["cluster"];
		programId: string;
		decoderVersion: string;
		startSlot: number;
		endSlot: number;
	}): Promise<GenesisReconciliationSnapshot>;
};

export class GenesisReconciliationMismatch extends Error {
	readonly reason: string;
	constructor(reason: string) {
		super(`Genesis finalized reconciliation failed: ${reason}.`);
		this.reason = reason;
	}
}

const identity = (event: Pick<StoredGenesisEvent, "cluster" | "signature" | "instructionIndex" | "eventIndex">) =>
	JSON.stringify([event.cluster, event.signature, event.instructionIndex, event.eventIndex]);

/** Checks one previously indexed finalized range. This function never writes ledger or reward state. */
export async function reconcileGenesisRange<Transaction>(input: {
	campaignId: string;
	cluster: GenesisChainEventRecord["cluster"];
	startSlot: number;
	endSlot: number;
	source: FinalizedSource<Transaction>;
	decoder: VerifiedGenesisDecoder<Transaction>;
	reader: GenesisReconciliationReader;
	fingerprint: (record: GenesisChainEventRecord) => { eventSha256: string };
}) {
	const { campaignId, cluster, startSlot, endSlot, source, decoder, reader, fingerprint } = input;
	if (!campaignId || !decoder.programId || !decoder.version ||
		!Number.isSafeInteger(startSlot) || startSlot < 0 ||
		!Number.isSafeInteger(endSlot) || endSlot < startSlot || endSlot - startSlot >= 512) {
		throw new RangeError("Invalid Genesis reconciliation range or decoder.");
	}
	const finalizedSlot = await source.finalizedSlot();
	if (!Number.isSafeInteger(finalizedSlot) || finalizedSlot < endSlot) {
		throw new GenesisReconciliationMismatch("source range is not finalized");
	}
	const blocks = await source.readRange(startSlot, endSlot);
	const observed = new Map<string, { slot: number; blockTimeSeconds: number; hash: string }>();
	let lastSlot = startSlot - 1;
	for (const block of blocks) {
		if (!Number.isSafeInteger(block.slot) || block.slot < startSlot || block.slot > endSlot ||
			block.slot <= lastSlot || !Number.isSafeInteger(block.blockTimeSeconds) || block.blockTimeSeconds < 0) {
			throw new GenesisReconciliationMismatch("invalid finalized block sequence");
		}
		lastSlot = block.slot;
		for (const record of await decoder.decode(block)) {
			if (record.campaignId !== campaignId || record.cluster !== cluster ||
				record.slot !== block.slot || record.blockTimeSeconds !== block.blockTimeSeconds) {
				throw new GenesisReconciliationMismatch("decoder returned event outside verified block");
			}
			const key = identity(record);
			if (observed.has(key)) throw new GenesisReconciliationMismatch("duplicate decoded identity");
			observed.set(key, { slot: block.slot, blockTimeSeconds: block.blockTimeSeconds,
				hash: fingerprint(record).eventSha256 });
		}
	}
	const snapshot = await reader.readSnapshot({ campaignId, cluster, programId: decoder.programId,
		decoderVersion: decoder.version, startSlot, endSlot });
	if (!Number.isSafeInteger(snapshot.nextSlot) || snapshot.nextSlot <= endSlot) {
		throw new GenesisReconciliationMismatch("stored cursor has not passed range");
	}
	if (!Number.isSafeInteger(snapshot.openConflictCount) || snapshot.openConflictCount !== 0) {
		throw new GenesisReconciliationMismatch("unresolved ingest conflict in range");
	}
	const stored = new Map<string, StoredGenesisEvent>();
	for (const event of snapshot.events) {
		if (event.cluster !== cluster || !Number.isSafeInteger(event.slot) || event.slot < startSlot || event.slot > endSlot ||
			!Number.isSafeInteger(event.blockTimeSeconds) || event.blockTimeSeconds < 0 ||
			event.decoderVersion !== decoder.version || !/^[0-9a-f]{64}$/.test(event.eventSha256)) {
			throw new GenesisReconciliationMismatch("invalid stored event in range");
		}
		const key = identity(event);
		if (stored.has(key)) throw new GenesisReconciliationMismatch("duplicate stored identity");
		stored.set(key, event);
	}
	for (const [key, event] of observed) {
		const saved = stored.get(key);
		if (!saved) throw new GenesisReconciliationMismatch("finalized event missing from ledger");
		if (saved.eventSha256 !== event.hash || saved.slot !== event.slot || saved.blockTimeSeconds !== event.blockTimeSeconds) {
			throw new GenesisReconciliationMismatch("stored event differs from finalized source");
		}
	}
	if (stored.size !== observed.size) throw new GenesisReconciliationMismatch("extra ledger event in range");
	return { campaignId, cluster, programId: decoder.programId, decoderVersion: decoder.version,
		startSlot, endSlot, nextSlot: snapshot.nextSlot, checkedEvents: observed.size };
}
