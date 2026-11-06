import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { preparePositionBaselineAnchor } from "./position-baseline-anchor.mjs";
import { preparePositionOwnershipEvidence } from "./position-ownership-evidence-store.mjs";

const CLOSE = createHash("sha256")
	.update("global:close_position")
	.digest()
	.subarray(0, 8);
const digest = (value) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function verifyOwnershipRangeAnchor(anchor) {
	const p = preparePositionBaselineAnchor({
		...anchor,
		snapshots: anchor?.evidence?.map((e) => e.raw),
	});
	if (!isDeepStrictEqual(anchor, p.bundle))
		throw new Error("Ownership range: canonical anchor required");
	return p;
}
function bounds(anchor, start, end) {
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(end) ||
		start <= anchor.anchorSlot ||
		end < start ||
		end >= Number.MAX_SAFE_INTEGER ||
		end - start >= 256
	)
		throw new Error("Ownership range: bounded post-anchor range required");
}
function hashAddress(value) {
	if (typeof value !== "string" || new PublicKey(value).toBase58() !== value)
		throw new Error("Ownership range: canonical block hash required");
	return value;
}

/** Complete supplied full-block claims, not provider authentication or state replay. */
export function decodePositionOwnershipBlockRange({
	anchor,
	startSlot,
	endSlot,
	producedSlots,
	blocks,
}) {
	const p = verifyOwnershipRangeAnchor(anchor);
	anchor = p.bundle;
	bounds(anchor, startSlot, endSlot);
	if (
		!Array.isArray(producedSlots) ||
		!Array.isArray(blocks) ||
		blocks.length !== producedSlots.length ||
		producedSlots.length > 256
	)
		throw new Error(
			"Ownership range: complete produced-slot list and blocks required",
		);
	const observations = [],
		metadata = [],
		signatures = new Set();
	let total = 0,
		previous;
	for (let i = 0; i < producedSlots.length; i++) {
		const slot = producedSlots[i],
			entry = blocks[i],
			block = entry?.block;
		if (
			!Number.isSafeInteger(slot) ||
			slot < startSlot ||
			slot > endSlot ||
			(i > 0 && slot <= producedSlots[i - 1]) ||
			entry?.slot !== slot ||
			!block ||
			!Array.isArray(block.transactions) ||
			!Number.isSafeInteger(block.blockTime) ||
			block.blockTime < 0 ||
			block.blockTime > 8640000000000 ||
			!Number.isSafeInteger(block.parentSlot) ||
			block.parentSlot < 0 ||
			block.parentSlot >= slot
		)
			throw new Error("Ownership range: malformed or incomplete full block");
		hashAddress(block.blockhash);
		hashAddress(block.previousBlockhash);
		if (
			previous
				? block.parentSlot !== previous.slot ||
					block.previousBlockhash !== previous.blockhash
				: block.parentSlot >= startSlot
		)
			throw new Error("Ownership range: produced-block parent chain differs");
		total += block.transactions.length;
		if (total > 2048)
			throw new Error("Ownership range: transaction bound exceeded");
		const transfers = [],
			closures = [],
			transactionClaims = [];
		for (const [transactionIndex, response] of block.transactions.entries()) {
			const signature = response?.transaction?.signatures?.[0],
				meta = response?.meta;
			if (
				typeof signature !== "string" ||
				!signature ||
				signature.length > 128 ||
				signatures.has(signature) ||
				!meta ||
				meta.err === undefined
			)
				throw new Error(
					"Ownership range: incomplete or duplicate block transaction",
				);
			signatures.add(signature);
			const failed = meta.err !== null;
			if (
				failed &&
				!(typeof meta.err === "string" && meta.err.length > 0) &&
				!(typeof meta.err === "object" && !Array.isArray(meta.err))
			)
				throw new Error("Ownership range: malformed transaction failure");
			transactionClaims.push({ signature, transactionIndex, failed });
			if (failed) continue; // Failed attempts cannot change chain state.
			const message = response.transaction.message;
			const lookups = message?.addressTableLookups ?? [];
			for (const [kind, field] of [
				["writable", "writableIndexes"],
				["readonly", "readonlyIndexes"],
			]) {
				if (
					(meta.loadedAddresses?.[kind]?.length ?? 0) !==
					lookups.reduce((n, l) => n + l[field].length, 0)
				)
					throw new Error("Ownership range: incomplete loaded addresses");
			}
			const keys = [
				...message.staticAccountKeys,
				...(meta.loadedAddresses?.writable ?? []),
				...(meta.loadedAddresses?.readonly ?? []),
			].map((k) => k.toBase58());
			if (new Set(keys).size !== keys.length)
				throw new Error("Ownership range: duplicate resolved accounts");
			const isClose = message.compiledInstructions.some(
				(ix) =>
					keys[ix.programIdIndex] === anchor.programId &&
					Buffer.from(ix.data).equals(CLOSE),
			);
			const normalized = {
				...response,
				slot,
				blockTime: block.blockTime,
				transactionIndex,
			};
			(isClose ? closures : transfers).push(normalized);
		}
		const batch = preparePositionOwnershipEvidence({
			anchor,
			slot,
			blockTimeSeconds: block.blockTime,
			transferTransactions: transfers,
			closureTransactions: closures,
		});
		observations.push(...batch.observations);
		if (observations.length > 4096)
			throw new Error("Ownership range: observation bound exceeded");
		previous = { slot, blockhash: block.blockhash };
		metadata.push({
			slot,
			parentSlot: block.parentSlot,
			blockhash: block.blockhash,
			previousBlockhash: block.previousBlockhash,
			blockTimeSeconds: block.blockTime,
			transactions: transactionClaims,
		});
	}
	observations.sort((a, b) =>
		a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0,
	);
	const result = {
		state: "TEST_ONLY_POSITION_OWNERSHIP_BLOCK_RANGE",
		awardEligible: false,
		coverage: "PROVIDED_FINALIZED_BLOCK_RANGE",
		network: anchor.network,
		campaignId: anchor.campaignId,
		programId: anchor.programId,
		decoderVersion: "position-ownership-v1",
		anchorSha256: p.evidenceSetSha256,
		startSlot,
		endSlot,
		producedSlots: [...producedSlots],
		blocks: metadata,
		observations,
	};
	if (Buffer.byteLength(JSON.stringify(result)) > 4194304)
		throw new Error("Ownership range: evidence range too large");
	return { ...result, rangeSha256: digest(result) };
}

/** Caller supplies a startup-verified Devnet connection; no endpoint/default caller. */
export function createPositionOwnershipBlockReader({ connection, anchor }) {
	const p = verifyOwnershipRangeAnchor(anchor);
	anchor = p.bundle;
	if (
		!["getSlot", "getFirstAvailableBlock", "getBlocks", "getBlock"].every(
			(name) => typeof connection?.[name] === "function",
		)
	)
		throw new Error("Ownership range: verified finalized connection required");
	return {
		async read({ startSlot, endSlot }) {
			bounds(anchor, startSlot, endSlot);
			const head = await connection.getSlot("finalized");
			if (!Number.isSafeInteger(head) || head < endSlot)
				throw new Error("Ownership range: range exceeds finalized head");
			const firstAvailable = await connection.getFirstAvailableBlock();
			if (
				!Number.isSafeInteger(firstAvailable) ||
				firstAvailable < 0 ||
				firstAvailable > startSlot
			)
				throw new Error(
					"Ownership range: provider history is pruned or unavailable",
				);
			const producedSlots = await connection.getBlocks(
				startSlot,
				endSlot,
				"finalized",
			);
			// Reject oversized/malformed responses before issuing any per-block requests.
			if (
				!Array.isArray(producedSlots) ||
				producedSlots.length > 256 ||
				producedSlots.some(
					(slot, i) =>
						!Number.isSafeInteger(slot) ||
						slot < startSlot ||
						slot > endSlot ||
						(i > 0 && slot <= producedSlots[i - 1]),
				)
			)
				throw new Error("Ownership range: invalid produced slots");
			const blocks = [];
			for (const slot of producedSlots)
				blocks.push({
					slot,
					block: await connection.getBlock(slot, {
						commitment: "finalized",
						transactionDetails: "full",
						maxSupportedTransactionVersion: 1,
						rewards: false,
					}),
				});
			return decodePositionOwnershipBlockRange({
				anchor,
				startSlot,
				endSlot,
				producedSlots,
				blocks,
			});
		},
	};
}
