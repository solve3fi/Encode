import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { passportAtEvent } from "./wallet-link-attribution.mjs";

function seconds(value, label) {
	if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000) {
		throw new RangeError(`Passport source: invalid ${label}`);
	}
	return value;
}

/**
 * Pure, test-only source attribution. Caller must supply a complete stable
 * finalized swap + wallet-history snapshot. These claims are not chain/database
 * verification; there is no public caller, qualification, valuation or award.
 */
export function projectPassportSwapEvidence({
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
}) {
	if (
		network !== "DEVNET" ||
		typeof campaignId !== "string" ||
		!campaignId ||
		typeof decoderVersion !== "string" ||
		!decoderVersion ||
		!Array.isArray(events) ||
		!Array.isArray(histories)
	) {
		throw new TypeError(
			"Passport source: complete Devnet snapshot and pinned identity required",
		);
	}
	for (const [value, label] of [
		[startSlot, "starting slot"],
		[computedThroughSlot, "computed slot"],
		[nextSlot, "next slot"],
		[reconciledThroughSlot, "reconciled slot"],
	]) {
		if (!Number.isSafeInteger(value) || value < 0)
			throw new RangeError(`Passport source: invalid ${label}`);
	}
	if (
		startSlot > computedThroughSlot ||
		nextSlot <= computedThroughSlot ||
		reconciledThroughSlot < computedThroughSlot ||
		reconciledThroughSlot >= nextSlot
	) {
		throw new Error("Passport source: snapshot range is not fully reconciled");
	}
	seconds(startsAtSeconds, "campaign start");
	seconds(endsAtSeconds, "campaign end");
	if (endsAtSeconds <= startsAtSeconds)
		throw new RangeError("Passport source: invalid campaign window");
	const historyByWallet = new Map();
	for (const history of histories) {
		if (!history || historyByWallet.has(history.wallet))
			throw new Error("Passport source: duplicate or invalid wallet history");
		// Validate the whole interval history, including inactive and unused links.
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
			record.campaignId !== campaignId ||
			record.cluster !== "devnet" ||
			record.eventKind !== "swap" ||
			event.decoderVersion !== decoderVersion ||
			record.slot < startSlot ||
			record.slot > computedThroughSlot
		) {
			throw new Error(
				"Passport source: event lies outside pinned swap snapshot",
			);
		}
		const fingerprint = fingerprintGenesisEvent(record);
		if (event.eventSha256 !== fingerprint.eventSha256)
			throw new Error(
				"Passport source: event hash differs from immutable evidence",
			);
		seconds(record.blockTimeSeconds, "event time");
		if (!historyByWallet.has(record.wallet))
			throw new Error(
				"Passport source: explicit complete wallet history is missing",
			);
		const key = JSON.stringify(fingerprint.identity);
		const previous = unique.get(key);
		if (previous && previous.eventSha256 !== event.eventSha256)
			throw new Error("Passport source: conflicting replay identity");
		unique.set(key, { record, eventSha256: event.eventSha256, sourceKey: key });
	}
	const passportRows = new Map();
	const unattributedSources = [];
	const outsideCampaignSources = [];
	for (const { record, eventSha256, sourceKey } of [...unique.values()].sort(
		(a, b) =>
			a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0,
	)) {
		if (
			record.blockTimeSeconds < startsAtSeconds ||
			record.blockTimeSeconds >= endsAtSeconds
		) {
			outsideCampaignSources.push(sourceKey);
			continue;
		}
		const passportId = passportAtEvent({
			network,
			wallet: record.wallet,
			eventAt: new Date(record.blockTimeSeconds * 1000).toISOString(),
			links: historyByWallet.get(record.wallet),
		});
		if (passportId === null) {
			unattributedSources.push(sourceKey);
			continue;
		}
		if (!passportRows.has(passportId))
			passportRows.set(passportId, {
				passportId,
				days: new Set(),
				sources: [],
			});
		const row = passportRows.get(passportId);
		row.days.add(Math.floor(record.blockTimeSeconds / 86_400));
		row.sources.push({
			sourceKey,
			eventSha256,
			wallet: record.wallet,
			slot: record.slot,
			occurredAtSeconds: record.blockTimeSeconds,
		});
	}
	return {
		state: "TEST_ONLY_SOURCE_EVIDENCE",
		network,
		campaignId,
		decoderVersion,
		startSlot,
		computedThroughSlot,
		passports: [...passportRows.values()]
			.sort((a, b) =>
				a.passportId < b.passportId ? -1 : a.passportId > b.passportId ? 1 : 0,
			)
			.map((row) => ({
				passportId: row.passportId,
				finalizedSwapEvents: row.sources.length,
				activeUtcDayIndices: [...row.days].sort((a, b) => a - b),
				sources: row.sources,
			})),
		unattributedSources,
		outsideCampaignSources,
	};
}
