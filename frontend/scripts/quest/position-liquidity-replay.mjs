import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {copyRpcMessage} from "./rpc-message-copy.mjs";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { createVerifiedSolveDecoder } from "../../src/lib/genesis/solveDecoder.ts";
import {
	decodePositionOwnershipBlockRange,
	verifyOwnershipRangeAnchor,
} from "./position-ownership-block-range.mjs";
import {
	TIMELINE_VERSION,
	timelineHash,
} from "./position-timeline-integrity.mjs";
import { projectPositionTimeline } from "./position-timeline-projector.mjs";

const fail = (message) => {
	throw new Error(`Liquidity replay: ${message}`);
};
const digest = (value) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Raw supplied full blocks only; no stored coverage, provider or price authentication. */
export async function decodePositionLiquidityBlockRange(input) {
	const p = verifyOwnershipRangeAnchor(input.anchor),
		anchor = p.bundle;
	if (
		!Array.isArray(input.blocks) ||
		input.blocks.length > 256 ||
		input.blocks.reduce(
			(n, e) => n + (e?.block?.transactions?.length ?? 2049),
			0,
		) > 2048
	)
		fail("bounded full blocks required");
	// Preserve the exact checked input across the asynchronous Solve decoder.
	input = {
		anchor,
		startSlot: input.startSlot,
		endSlot: input.endSlot,
		producedSlots: [...input.producedSlots],
		blocks: input.blocks.map(({ slot, block }) => ({
			slot,
			block: {
				...block,
				transactions: block.transactions.map((tx) => {
					const loaded = tx.meta?.loadedAddresses;
					const meta = structuredClone({
						...tx.meta,
						loadedAddresses: undefined,
					});
					if (loaded)
						meta.loadedAddresses = Object.fromEntries(
							["writable", "readonly"].map((kind) => [
								kind,
								loaded[kind].map((k) => new PublicKey(k.toBytes())),
							]),
						);
					return {
						...tx,
						meta,
						transaction: {
							signatures: [...tx.transaction.signatures],
							message: copyRpcMessage(tx.transaction.message),
						},
					};
				}),
			},
		})),
	};
	// Reuse exact full-block bounds, failed-attempt handling, global ordering,
	// loaded-address checks and the narrow transfer/closure proofs.
	const ownership = decodePositionOwnershipBlockRange({ ...input, anchor });
	const decoder = createVerifiedSolveDecoder({
		campaignId: anchor.campaignId,
		cluster: "devnet",
		programId: anchor.programId,
	});
	const byPosition = new Map(
		anchor.evidence.map(({ observation: o }) => [o.positionAddress, o]),
	);
	const closedSignatures = new Set(
		ownership.observations
			.filter((e) => e.record.eventKind === "position_close_observed")
			.map((e) => e.record.signature),
	);
	const changes = [];
	let previousTime = -1;
	for (const { slot, block } of input.blocks) {
		if (block.blockTime < previousTime) fail("nonmonotonic full-block time");
		previousTime = block.blockTime;
		for (const [transactionIndex, tx] of block.transactions.entries()) {
			if (tx.meta.err !== null) continue;
			const message = tx.transaction.message;
			const keys = [
				...message.staticAccountKeys,
				...(tx.meta.loadedAddresses?.writable ?? []),
				...(tx.meta.loadedAddresses?.readonly ?? []),
			].map((k) => k.toBase58());
			if (closedSignatures.has(tx.transaction.signatures[0])) {
				// The existing Genesis decoder deliberately rejects closure. Keep it
				// unchanged and only bypass an independently proven standalone close.
				if (
					message.compiledInstructions.filter(
						(ix) => keys[ix.programIdIndex] === anchor.programId,
					).length !== 1
				)
					fail("combined Solve closure unsupported");
				if (
					tx.meta.innerInstructions?.some((group) =>
						group.instructions.some(
							(ix) => keys[ix.programIdIndex] === anchor.programId,
						),
					) ||
					tx.meta.logMessages?.some((log) => {
						const invocation =
							/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(log);
						return (
							invocation?.[1] === anchor.programId && Number(invocation[2]) > 1
						);
					})
				)
					fail("Solve CPI alongside closure unsupported");
				continue;
			}
			const records = await decoder.decode({
				slot,
				blockTimeSeconds: block.blockTime,
				transactions: [tx],
			});
			for (const record of records) {
				if (record.eventKind === "swap") continue;
				const baseline = byPosition.get(record.positionAddress);
				if (!baseline) continue; // Inventory is immutable and explicitly selected.
				if (record.eventKind === "position_open")
					fail("anchored position reopened");
				const kind = record.payload.instructionKind;
				if (!["increase_liquidity", "decrease_liquidity"].includes(kind))
					fail("selected liquidity variant unsupported");
				const ix = message.compiledInstructions[record.instructionIndex],
					data = Buffer.from(ix.data);
				if (data.length !== 40)
					fail("exact legacy liquidity arguments required");
				const delta =
					data.readBigUInt64LE(8) + (data.readBigUInt64LE(16) << 64n);
				if (delta.toString() !== record.payload.liquidityRaw || delta === 0n)
					fail("positive liquidity argument/event delta must agree");
				const tokenAccountAddress = keys[ix.accountKeyIndexes[4]];
				const nft = tx.meta.preTokenBalances?.find(
					(b) => b.accountIndex === ix.accountKeyIndexes[4],
				);
				if (
					nft?.mint !== baseline.positionMint ||
					record.poolAddress !== baseline.poolAddress ||
					record.payload.tickLowerIndex !== baseline.tickLowerIndex ||
					record.payload.tickUpperIndex !== baseline.tickUpperIndex
				)
					fail("position mint, pool or ticks differ from anchor");
				const fingerprint = fingerprintGenesisEvent(record);
				changes.push({
					sourceKey: JSON.stringify(fingerprint.identity),
					eventSha256: fingerprint.eventSha256,
					transactionIndex,
					positionMint: baseline.positionMint,
					tokenAccountAddress,
					record,
				});
				if (changes.length > 4096) fail("liquidity observation bound exceeded");
			}
		}
	}
	const bundle = {
		schemaVersion: 1,
		state: "TEST_ONLY_POSITION_TIMELINE_RANGE",
		awardEligible: false,
		network: anchor.network,
		campaignId: anchor.campaignId,
		programId: anchor.programId,
		decoderVersion: TIMELINE_VERSION,
		solveDecoderVersion: decoder.version,
		anchorSha256: p.evidenceSetSha256,
		startSlot: input.startSlot,
		endSlot: input.endSlot,
		ownershipRange: ownership,
		liquidityObservations: changes,
	};
	if (Buffer.byteLength(JSON.stringify(bundle)) > 4194304)
		fail("replay evidence too large");
	return { ...bundle, bundleSha256: timelineHash(bundle) };
}

export async function replayPositionLiquidityBlockRange(input) {
	const range = await decodePositionLiquidityBlockRange(input);
	if (range.startSlot !== input.anchor.firstReplaySlot)
		fail("complete anchor prefix required");
	const projected = projectPositionTimeline({
		anchor: input.anchor,
		ranges: [range],
		endSlot: range.endSlot,
	});
	const result = {
		state: "TEST_ONLY_POSITION_LIQUIDITY_REPLAY",
		awardEligible: false,
		coverage: "PROVIDED_FINALIZED_BLOCK_RANGE",
		scope: "SELECTED_POSITIONS_ONLY",
		network: range.network,
		campaignId: range.campaignId,
		programId: range.programId,
		decoderVersion: "position-liquidity-replay-v1",
		solveDecoderVersion: range.solveDecoderVersion,
		anchorSha256: range.anchorSha256,
		startSlot: range.startSlot,
		endSlot: range.endSlot,
		ownershipRangeSha256: range.ownershipRange.rangeSha256,
		liquidityObservations: range.liquidityObservations,
		positions: projected.positions,
	};
	return { ...result, replaySha256: digest(result) };
}
