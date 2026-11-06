import { PublicKey } from "@solana/web3.js";
import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { passportAtEvent } from "./wallet-link-attribution.mjs";

const INSTRUCTIONS = {
	position_open: [
		"open_position",
		"open_position_with_metadata",
		"open_position_with_token_extensions",
	],
	liquidity_increase: ["increase_liquidity", "increase_liquidity_v2"],
	liquidity_decrease: ["decrease_liquidity", "decrease_liquidity_v2"],
};

function address(value) {
	if (typeof value !== "string" || new PublicKey(value).toBase58() !== value)
		throw new TypeError("Position evidence: canonical address required");
}

function unsigned(value, bits) {
	if (
		typeof value !== "string" ||
		!/^(0|[1-9][0-9]*)$/.test(value) ||
		value.length > 39 ||
		BigInt(value) >= 1n << BigInt(bits)
	) {
		throw new TypeError("Position evidence: invalid exact unsigned amount");
	}
}

export function validatePositionEvidencePayload(record) {
	const payload = record.payload;
	if (
		!payload ||
		!INSTRUCTIONS[record.eventKind]?.includes(payload.instructionKind) ||
		record.eventIndex !== 0 ||
		payload.kind !== record.eventKind ||
		payload.poolAddress !== record.poolAddress ||
		payload.positionAddress !== record.positionAddress ||
		!Number.isInteger(payload.tickLowerIndex) ||
		!Number.isInteger(payload.tickUpperIndex) ||
		payload.tickLowerIndex < -2147483648 ||
		payload.tickUpperIndex > 2147483647 ||
		payload.tickLowerIndex >= payload.tickUpperIndex
	) {
		throw new Error(
			"Position evidence: unsupported or inconsistent position payload",
		);
	}
	address(record.wallet);
	address(record.poolAddress);
	address(record.positionAddress);
	if (record.eventKind !== "position_open") {
		unsigned(payload.liquidityRaw, 128);
		for (const field of [
			"tokenAAmountRaw",
			"tokenBAmountRaw",
			"tokenATransferFeeRaw",
			"tokenBTransferFeeRaw",
		])
			unsigned(payload[field], 64);
	} else if (
		[
			"liquidityRaw",
			"tokenAAmountRaw",
			"tokenBAmountRaw",
			"tokenATransferFeeRaw",
			"tokenBTransferFeeRaw",
		].some((field) => Object.hasOwn(payload, field))
	) {
		throw new Error(
			"Position evidence: open event cannot claim liquidity amounts",
		);
	}
}

/**
 * Dormant event observations from a caller-supplied complete finalized snapshot.
 * Hash equality and claimed reconciliation do not independently prove chain data.
 * An observed transaction owner never becomes an ownership interval or LP balance.
 */
export function projectPassportPositionEvidence(input) {
	const {
		network,
		campaignId,
		decoderVersion,
		startSlot,
		computedThroughSlot,
		nextSlot,
		reconciledThroughSlot,
		startsAtSeconds,
		endsAtSeconds,
		events,
		histories,
	} = input;
	if (
		network !== "DEVNET" ||
		typeof campaignId !== "string" ||
		!campaignId ||
		typeof decoderVersion !== "string" ||
		!decoderVersion ||
		!Array.isArray(events) ||
		events.length > 10000 ||
		!Array.isArray(histories) ||
		histories.length > 10000
	)
		throw new TypeError(
			"Position evidence: bounded complete Devnet snapshot required",
		);
	if (
		[startSlot, computedThroughSlot, nextSlot, reconciledThroughSlot].some(
			(value) => !Number.isSafeInteger(value) || value < 0,
		) ||
		startSlot > computedThroughSlot ||
		nextSlot <= computedThroughSlot ||
		reconciledThroughSlot < computedThroughSlot ||
		reconciledThroughSlot >= nextSlot
	)
		throw new Error(
			"Position evidence: snapshot range is not fully reconciled",
		);
	if (
		[startsAtSeconds, endsAtSeconds].some(
			(value) =>
				!Number.isSafeInteger(value) || value < 0 || value > 8640000000000,
		) ||
		endsAtSeconds <= startsAtSeconds
	)
		throw new Error("Position evidence: invalid campaign window");
	const historyByWallet = new Map();
	let linkCount = 0;
	for (const history of histories) {
		if (
			!history ||
			historyByWallet.has(history.wallet) ||
			!Array.isArray(history.links)
		)
			throw new Error(
				"Position evidence: duplicate or incomplete wallet history",
			);
		linkCount += history.links.length;
		if (linkCount > 20000)
			throw new Error("Position evidence: wallet history limit exceeded");
		address(history.wallet);
		for (const link of history.links) {
			for (const value of [link?.linkedAt, link?.unlinkedAt]) {
				if (value === null) continue;
				if (
					typeof value !== "string" ||
					!Number.isFinite(Date.parse(value)) ||
					new Date(value).toISOString() !== value
				)
					throw new Error(
						"Position evidence: canonical millisecond link timestamps required",
					);
			}
		}
		passportAtEvent({
			network,
			wallet: history.wallet,
			eventAt: new Date(startsAtSeconds * 1000).toISOString(),
			links: history.links,
		});
		historyByWallet.set(history.wallet, history.links);
	}
	const unique = new Map();
	for (const event of events) {
		const record = event?.record;
		if (
			!record ||
			typeof record.signature !== "string" ||
			record.campaignId !== campaignId ||
			record.cluster !== "devnet" ||
			!Object.hasOwn(INSTRUCTIONS, record.eventKind) ||
			event.decoderVersion !== decoderVersion ||
			record.slot < startSlot ||
			record.slot > computedThroughSlot ||
			record.blockTimeSeconds > 8640000000000
		)
			throw new Error(
				"Position evidence: event outside pinned position snapshot",
			);
		const fingerprint = fingerprintGenesisEvent(record);
		if (event.eventSha256 !== fingerprint.eventSha256)
			throw new Error(
				"Position evidence: hash differs from immutable evidence",
			);
		validatePositionEvidencePayload(record);
		if (!historyByWallet.has(record.wallet))
			throw new Error(
				"Position evidence: explicit complete wallet history missing",
			);
		const sourceKey = JSON.stringify(fingerprint.identity);
		const previous = unique.get(sourceKey);
		if (previous && previous.eventSha256 !== event.eventSha256)
			throw new Error("Position evidence: conflicting replay identity");
		unique.set(sourceKey, {
			record,
			sourceKey,
			eventSha256: event.eventSha256,
		});
	}
	const positions = new Map();
	for (const { record, sourceKey, eventSha256 } of [...unique.values()].sort(
		(a, b) =>
			a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0,
	)) {
		const payload = record.payload;
		let position = positions.get(record.positionAddress);
		if (!position) {
			position = {
				positionAddress: record.positionAddress,
				poolAddress: record.poolAddress,
				tickLowerIndex: payload.tickLowerIndex,
				tickUpperIndex: payload.tickUpperIndex,
				observations: [],
			};
			positions.set(record.positionAddress, position);
		}
		if (
			position.poolAddress !== record.poolAddress ||
			position.tickLowerIndex !== payload.tickLowerIndex ||
			position.tickUpperIndex !== payload.tickUpperIndex
		)
			throw new Error("Position evidence: immutable position identity changed");
		if (
			record.eventKind === "position_open" &&
			position.observations.some((row) => row.eventKind === "position_open")
		)
			throw new Error("Position evidence: repeated position open");
		const inside =
			startsAtSeconds <= record.blockTimeSeconds &&
			record.blockTimeSeconds < endsAtSeconds;
		const passportId = inside
			? passportAtEvent({
					network,
					wallet: record.wallet,
					eventAt: new Date(record.blockTimeSeconds * 1000).toISOString(),
					links: historyByWallet.get(record.wallet),
				})
			: null;
		position.observations.push({
			sourceKey,
			eventSha256,
			eventKind: record.eventKind,
			instructionKind: payload.instructionKind,
			instructionIndex: record.instructionIndex,
			eventIndex: record.eventIndex,
			slot: record.slot,
			occurredAtSeconds: record.blockTimeSeconds,
			observedOwnerWallet: record.wallet,
			passportId,
			attributionState: !inside
				? "OUTSIDE_CAMPAIGN"
				: passportId === null
					? "UNLINKED"
					: "LINKED",
			...(record.eventKind === "position_open"
				? {}
				: {
						liquidityRaw: payload.liquidityRaw,
						tokenAAmountRaw: payload.tokenAAmountRaw,
						tokenBAmountRaw: payload.tokenBAmountRaw,
						tokenATransferFeeRaw: payload.tokenATransferFeeRaw,
						tokenBTransferFeeRaw: payload.tokenBTransferFeeRaw,
					}),
		});
	}
	return {
		state: "TEST_ONLY_POSITION_OBSERVATIONS",
		awardEligible: false,
		ownershipCoverage: "TRANSACTION_ONLY",
		network,
		campaignId,
		decoderVersion,
		startSlot,
		computedThroughSlot,
		nextSlot,
		reconciledThroughSlot,
		startsAtSeconds,
		endsAtSeconds,
		positions: [...positions.values()].sort((a, b) =>
			a.positionAddress < b.positionAddress
				? -1
				: a.positionAddress > b.positionAddress
					? 1
					: 0,
		),
	};
}
