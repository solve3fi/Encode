import { isDeepStrictEqual } from "node:util";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { validatePositionEvidencePayload } from "./passport-position-evidence.mjs";
import { verifyOwnershipRangeAnchor } from "./position-ownership-block-range.mjs";
import { ownershipReconciliationRow } from "./position-ownership-reconciliation.mjs";
import { projectPositionOwnershipState } from "./position-ownership-state-reader.mjs";
import {
	timelineFail as fail,
	timelineInteger as integer,
	timelineKey as key,
	TIMELINE_VERSION,
	timelineClock,
	timelineHash,
} from "./position-timeline-integrity.mjs";

export function projectPositionTimeline(input) {
	return projectTimelinePage(input, null);
}

function projectTimelinePage({ anchor, ranges, endSlot, clock }, continuation) {
	const p = verifyOwnershipRangeAnchor(anchor);
	anchor = p.bundle;
	integer(endSlot);
	if (
		!Array.isArray(ranges) ||
		ranges.length < 1 ||
		ranges.length > 64 ||
		Buffer.byteLength(JSON.stringify(ranges)) > 16_777_216
	)
		fail("bounded complete prefix required");
	if (
		clock &&
		!isDeepStrictEqual(
			clock,
			timelineClock(anchor, {
				blockhash: clock.blockhash,
				blockTime: clock.blockTimeSeconds,
			}),
		)
	)
		fail("clock pins or hash differ");
	let next = continuation ? continuation.endSlot + 1 : anchor.firstReplaySlot,
		lastBlock = continuation ? continuation.lastBlock : clock
			? {
					slot: anchor.anchorSlot,
					blockhash: clock.blockhash,
					blockTimeSeconds: clock.blockTimeSeconds,
				}
			: null;
	const ownership = [],
		liquidity = [],
		claims = new Map(),
		signatures = new Set(),
		sources = new Set(),
		byPosition = new Map(
			anchor.evidence.map(({ observation: o }) => [o.positionAddress, o]),
		);
	for (const range of ranges) {
		const { bundleSha256, ...bundle } = range;
		if (
			bundleSha256 !== timelineHash(bundle) ||
			range.schemaVersion !== 1 ||
			range.state !== "TEST_ONLY_POSITION_TIMELINE_RANGE" ||
			range.awardEligible !== false ||
			range.decoderVersion !== TIMELINE_VERSION ||
			range.solveDecoderVersion !== "solve-direct-2" ||
			range.anchorSha256 !== p.evidenceSetSha256 ||
			range.network !== anchor.network ||
			range.campaignId !== anchor.campaignId ||
			range.programId !== anchor.programId ||
			range.startSlot !== next ||
			integer(range.endSlot) < next ||
			range.endSlot - next > 255
		)
			fail(`range hash, pins or continuity differ at ${range.startSlot}-${range.endSlot}, expected ${next}`);
		const o = range.ownershipRange;
		if (
			o?.state !== "TEST_ONLY_POSITION_OWNERSHIP_BLOCK_RANGE" ||
			o.awardEligible !== false ||
			o.coverage !== "PROVIDED_FINALIZED_BLOCK_RANGE" ||
			o.decoderVersion !== "position-ownership-v1" ||
			o.anchorSha256 !== p.evidenceSetSha256 ||
			o.network !== anchor.network ||
			o.campaignId !== anchor.campaignId ||
			o.programId !== anchor.programId ||
			o.startSlot !== range.startSlot ||
			o.endSlot !== range.endSlot ||
			!Array.isArray(o.blocks) ||
			!Array.isArray(o.producedSlots) ||
			o.blocks.length !== o.producedSlots.length ||
			o.blocks.length > 256 ||
			!Array.isArray(o.observations) ||
			!Array.isArray(range.liquidityObservations) ||
			o.observations.length + range.liquidityObservations.length > 4096
		)
			fail("incomplete range evidence");
		let count = 0,
			previousSlot = range.startSlot - 1;
		for (const b of o.blocks) {
			integer(b.slot);
			integer(b.parentSlot);
			integer(b.blockTimeSeconds);
			key(b.blockhash);
			key(b.previousBlockhash);
			if (
				b.slot <= previousSlot ||
				b.slot > range.endSlot ||
				o.producedSlots[o.blocks.indexOf(b)] !== b.slot ||
				b.parentSlot >= b.slot ||
				!Array.isArray(b.transactions) ||
				b.blockTimeSeconds > 8_640_000_000_000 ||
				(lastBlock
					? b.parentSlot !== lastBlock.slot ||
						b.previousBlockhash !== lastBlock.blockhash ||
						b.blockTimeSeconds < lastBlock.blockTimeSeconds
					: b.parentSlot >= range.startSlot)
			)
				fail("cross-range block chain or time differs");
			previousSlot = b.slot;
			lastBlock = b;
			for (const [index, tx] of b.transactions.entries()) {
				if (
					tx.transactionIndex !== index ||
					typeof tx.failed !== "boolean" ||
					typeof tx.signature !== "string" ||
					!tx.signature ||
					tx.signature.length > 128 ||
					signatures.has(tx.signature)
				)
					fail("transaction claims differ");
				signatures.add(tx.signature);
				claims.set(`${b.slot}:${index}`, { ...tx, time: b.blockTimeSeconds });
			}
			count += b.transactions.length;
		}
		if (count > 2048) fail("transaction bound exceeded");
		const assertClaim = (e, index) => {
			const r = e.record,
				c = claims.get(`${r.slot}:${index}`);
			integer(r.instructionIndex);
			if (
				r.slot < range.startSlot ||
				r.slot > range.endSlot ||
				!c ||
				c.failed ||
				c.signature !== r.signature ||
				c.time !== r.blockTimeSeconds
			)
				fail("observation lacks matching full-block transaction");
			const identity = `${r.signature}:${r.instructionIndex}:${r.positionAddress}`;
			if (sources.has(identity)) fail("duplicate or contradictory mutation");
			sources.add(identity);
		};
		for (const e of o.observations) {
			assertClaim(e, e.record.transactionIndex);
			ownership.push(e);
		}
		for (const e of range.liquidityObservations) {
			const r = e.record;
			if (
				!isDeepStrictEqual(
					r,
					Object.fromEntries(
						"campaignId cluster signature instructionIndex eventIndex eventKind slot blockTimeSeconds wallet poolAddress positionAddress payload"
							.split(" ")
							.map((k) => [k, r[k]]),
					),
				) ||
				!isDeepStrictEqual(
					r.payload,
					Object.fromEntries(
						"instructionKind kind poolAddress positionAddress tickLowerIndex tickUpperIndex liquidityRaw tokenAAmountRaw tokenBAmountRaw tokenATransferFeeRaw tokenBTransferFeeRaw"
							.split(" ")
							.map((k) => [k, r.payload[k]]),
					),
				)
			)
				fail("unexpected liquidity record fields");
			integer(e.transactionIndex);
			assertClaim(e, e.transactionIndex);
			const baseline = byPosition.get(r.positionAddress),
				fingerprint = fingerprintGenesisEvent(r);
			validatePositionEvidencePayload(r);
			key(e.tokenAccountAddress);
			if (
				!baseline ||
				e.positionMint !== baseline.positionMint ||
				r.campaignId !== anchor.campaignId ||
				r.cluster !== "devnet" ||
				r.eventIndex !== 0 ||
				!["increase_liquidity", "decrease_liquidity"].includes(
					r.payload.instructionKind,
				) ||
				!["liquidity_increase", "liquidity_decrease"].includes(r.eventKind) ||
				BigInt(r.payload.liquidityRaw) === 0n ||
				r.poolAddress !== baseline.poolAddress ||
				r.payload.tickLowerIndex !== baseline.tickLowerIndex ||
				r.payload.tickUpperIndex !== baseline.tickUpperIndex ||
				!isDeepStrictEqual(e, {
					sourceKey: JSON.stringify(fingerprint.identity),
					eventSha256: fingerprint.eventSha256,
					transactionIndex: e.transactionIndex,
					positionMint: baseline.positionMint,
					tokenAccountAddress: e.tokenAccountAddress,
					record: r,
				})
			)
				fail("liquidity source hash or pins differ");
			liquidity.push(e);
		}
		next = range.endSlot + 1;
	}
	if (
		endSlot < anchor.firstReplaySlot ||
		endSlot >= next ||
		ownership.length + liquidity.length > 4096
	)
		fail("requested range uncovered or oversized");
	// Validate the entire covered owner history, including later rows in a final
	// range that partially overlaps the requested end. Then replay to that end.
	projectPositionOwnershipState({
		anchor,
		endSlot: next - 1,
		rows: ownership.map((e) =>
			ownershipReconciliationRow(e, p.evidenceSetSha256),
		),
		initialPositions: continuation?.positions,
	});
	const initial = new Map((continuation?.positions ?? []).map((s) => [s.positionMint,s]));
	const states = new Map(
		anchor.evidence.map(({ observation: o }) => [
			o.positionMint,
			{
				positionAddress: o.positionAddress,
				positionMint: o.positionMint,
				poolAddress: o.poolAddress,
				ownerWallet: initial.has(o.positionMint) ? initial.get(o.positionMint).ownerWallet : o.observedOwnerWallet,
				tokenAccountAddress: initial.has(o.positionMint) ? initial.get(o.positionMint).tokenAccountAddress : o.tokenAccountAddress,
				liquidity: BigInt(initial.get(o.positionMint)?.endSlotLiquidityRaw ?? o.liquidityRaw),
				closed: initial.get(o.positionMint)?.closed ?? false,
				transitions: [],
			},
		]),
	);
	const ordered = [
		...ownership.map((e) => ({
			...e,
			transactionIndex: e.record.transactionIndex,
			positionMint: e.record.positionMint,
			ownership: true,
		})),
		...liquidity.map((e) => ({ ...e, ownership: false })),
	].sort(
		(a, b) =>
			a.record.slot - b.record.slot ||
			a.transactionIndex - b.transactionIndex ||
			a.record.instructionIndex - b.record.instructionIndex,
	);
	const lastMeasuredBlock = ranges
		.flatMap((r) => r.ownershipRange.blocks)
		.filter((b) => b.slot <= endSlot)
		.at(-1);
	for (const e of ordered) {
		const r = e.record,
			s = states.get(e.positionMint);
		if (s.closed) fail("mutation after terminal closure");
		const before = s.liquidity.toString();
		if (!e.ownership) {
			if (
				r.wallet !== s.ownerWallet ||
				e.tokenAccountAddress !== s.tokenAccountAddress
			)
				fail("liquidity change does not follow current NFT ownership");
			s.liquidity +=
				r.eventKind === "liquidity_increase"
					? BigInt(r.payload.liquidityRaw)
					: -BigInt(r.payload.liquidityRaw);
			if (s.liquidity < 0n || s.liquidity >= 1n << 128n)
				fail("liquidity underflow or overflow");
		} else if (r.eventKind === "position_nft_transfer") {
			s.ownerWallet = r.toOwnerWallet;
			s.tokenAccountAddress = r.destinationTokenAccount;
		} else {
			if (s.liquidity !== 0n) fail("closure requires replayed zero liquidity");
			s.closed = true;
			s.ownerWallet = null;
			s.tokenAccountAddress = null;
		}
		if (r.slot <= endSlot)
			s.transitions.push({
				slot: r.slot,
				transactionIndex: e.transactionIndex,
				instructionIndex: r.instructionIndex,
				signature: r.signature,
				eventKind: r.eventKind,
				blockTimeSeconds: r.blockTimeSeconds,
				beforeLiquidityRaw: before,
				afterLiquidityRaw: s.liquidity.toString(),
				ownerWallet: s.ownerWallet,
				tokenAccountAddress: s.tokenAccountAddress,
				closed: s.closed,
			});
	}
	// For historical cutoffs retain the last transition at/before the cutoff,
	// after validating the complete selected prefix above.
	const positions = [...states.values()].map(({ liquidity, ...s }) => {
		const last = s.transitions.at(-1),
			o = byPosition.get(s.positionAddress);
		return {
			...s,
			ownerWallet: last ? last.ownerWallet : initial.has(o.positionMint) ? initial.get(o.positionMint).ownerWallet : o.observedOwnerWallet,
			tokenAccountAddress: last
				? last.tokenAccountAddress
				: initial.has(o.positionMint) ? initial.get(o.positionMint).tokenAccountAddress : o.tokenAccountAddress,
			closed: last ? last.closed : initial.get(o.positionMint)?.closed ?? false,
			endSlotLiquidityRaw: last ? last.afterLiquidityRaw : initial.get(o.positionMint)?.endSlotLiquidityRaw ?? o.liquidityRaw,
		};
	});
	return {
		state: "TEST_ONLY_POSITION_TIMELINE",
		awardEligible: false,
		network: anchor.network,
		campaignId: anchor.campaignId,
		scope: "SELECTED_POSITIONS_ONLY",
		anchorSha256: p.evidenceSetSha256,
		anchorSlot: anchor.anchorSlot,
		startSlot: continuation ? continuation.endSlot + 1 : anchor.firstReplaySlot,
		endSlot,
		positions,
		rangeHashes: ranges.map((r) => r.bundleSha256),
		measuredThroughSeconds:
			lastMeasuredBlock?.blockTimeSeconds ?? continuation?.lastBlock?.blockTimeSeconds ?? clock?.blockTimeSeconds ?? null,
		clock: clock ?? null,
	};
}

export function projectPositionTimelineIntervals({
	anchor,
	ranges,
	endSlot,
	clock,
}) {
	if (!clock) fail("anchored clock required for intervals");
	const state = projectPositionTimeline({ anchor, ranges, endSlot, clock });
	return intervalsForState(anchor,state,null,clock.blockTimeSeconds);
}

function intervalsForState(anchor,state,initialPositions,start) {
	const end = state.measuredThroughSeconds;
	const initial = new Map((initialPositions ?? []).map((s) => [s.positionMint,s]));
	const positions = state.positions.map((s) => {
		const o = anchor.evidence.find(
			(e) => e.observation.positionMint === s.positionMint,
		).observation;
		let from = start,
			wallet = initial.has(s.positionMint) ? initial.get(s.positionMint).ownerWallet : o.observedOwnerWallet,
			liquidity = initial.get(s.positionMint)?.endSlotLiquidityRaw ?? o.liquidityRaw,
			closed = initial.get(s.positionMint)?.closed ?? false;
		const intervals = [];
		const add = (to) => {
			if (to > from) {
				const value = {
					finality: "finalized",
					startsAtSeconds: from,
					endsAtSeconds: to,
					wallet,
					liquidityRaw: liquidity,
					closed,
				};
				intervals.push({
					...value,
					sourceKey: timelineHash({
						campaignId: anchor.campaignId,
						positionAddress: s.positionAddress,
						clockSha256: state.clock.clockSha256,
						rangeHashes: state.rangeHashes,
						...value,
					}),
				});
			}
			from = to;
		};
		for (const e of s.transitions) {
			add(e.blockTimeSeconds);
			wallet = e.ownerWallet;
			liquidity = e.afterLiquidityRaw;
			closed = e.closed;
		}
		add(end);
		return {
			positionAddress: s.positionAddress,
			poolAddress: s.poolAddress,
			intervals,
		};
	});
	return {
		...state,
		startsAtSeconds: start,
		endsAtSeconds: end,
		intervalPositions: positions,
		intervalSemantics: "STATE_AFTER_OBSERVED_BLOCK_TIMESTAMP",
		awardEligible: false,
	};
}

/** Bounded pages, with opaque in-process continuation derived only from verified
 * pages. The trusted SQL composition must check identities across the full prefix
 * in the same snapshot; page-local duplicate checks alone are insufficient.
 * This pure projection never grants XP or accepts a serialized checkpoint.
 */
export function createPositionTimelinePager({anchor,clock,assertGlobalIdentities}) {
	if (typeof assertGlobalIdentities !== "function") fail("full-prefix identity verifier required");
	anchor=structuredClone(verifyOwnershipRangeAnchor(anchor).bundle);
	clock=structuredClone(clock);
	if (!clock) fail("anchored clock required for paging");
	let continuation=null, historySha256=verifyOwnershipRangeAnchor(anchor).evidenceSetSha256, final=false;
	return Object.freeze({
		async append({ranges,endSlot}) {
			if (final) fail("historical cutoff already reached");
            if (!Array.isArray(ranges) || ranges.length>16) fail("bounded history page required");
			ranges=structuredClone(ranges);
			await assertGlobalIdentities({anchorSha256:verifyOwnershipRangeAnchor(anchor).evidenceSetSha256,endSlot});
			const state=projectTimelinePage({anchor,ranges,endSlot,clock},continuation);
			const result=intervalsForState(anchor,state,continuation?.positions,continuation?.lastBlock?.blockTimeSeconds ?? clock.blockTimeSeconds);
			const block=ranges.flatMap(r=>r.ownershipRange.blocks).filter(b=>b.slot<=endSlot).at(-1);
			const lastBlock=block ? {slot:block.slot,blockhash:block.blockhash,blockTimeSeconds:block.blockTimeSeconds} :
				continuation?.lastBlock ?? {slot:anchor.anchorSlot,blockhash:clock.blockhash,blockTimeSeconds:clock.blockTimeSeconds};
			const root=timelineHash({previousSha256:historySha256,rangeHashes:state.rangeHashes});
			continuation={endSlot,lastBlock,positions:structuredClone(state.positions)};
			historySha256=root;
			final=endSlot<ranges.at(-1).endSlot;
			return {...result,historySha256,historySemantics:"VERIFIED_PAGED_PREFIX"};
		},
	});
}
