import { fingerprintGenesisEvent } from "../../src/lib/genesis/eventFingerprint.ts";
import { assertPassportId } from "./passport-id.mjs";
import { projectPassportPositionEvidence } from "./passport-position-evidence.mjs";
import { projectPassportSwapEvidence } from "./passport-source-evidence.mjs";
import {
	projectPassportLpQualification,
	validateLpPolicy,
} from "./passport-lp-qualification.mjs";
import {
	projectPassportSwapQualification,
	validateSwapQualificationPolicy,
} from "./passport-swap-qualification.mjs";

function eventId(value) {
	if (
		typeof value !== "string" ||
		!/^[1-9][0-9]{0,18}$/.test(value) ||
		BigInt(value) > 9223372036854775807n
	) {
		throw new Error("Passport snapshot: invalid stored event ID");
	}
	return value;
}

export function createPassportSwapEvidenceReader(configuration) {
	return createPassportReader(configuration);
}

/** LP observations only; does not establish continuous position ownership. */
export function createPassportPositionEvidenceReader(configuration) {
	return createPassportReader(configuration, null, true);
}

/** Same stable snapshot, with complete stored valuations and test-only policy. */
export function createPassportSwapQualificationReader({
	policy,
	...configuration
}) {
	validateSwapQualificationPolicy(policy);
	if (policy.lp !== undefined) validateLpPolicy(policy.lp);
	if (policy.referrals !== undefined && typeof policy.referrals !== "boolean")
		throw new TypeError("Passport snapshot: referrals policy must be a boolean");
	const pinnedPolicy = Object.freeze({
		...(policy.referrals === true ? { referrals: true } : {}),
		...(policy.lp === undefined
			? {}
			: {
					lp: Object.freeze({
						featuredPools: [...policy.lp.featuredPools],
						minimumLpUsdCents: policy.lp.minimumLpUsdCents,
						minimumDwellSeconds: policy.lp.minimumDwellSeconds,
						valuationSource: policy.lp.valuationSource,
						valuationVersion: policy.lp.valuationVersion,
						...(policy.lp.requireInRange === undefined
							? {}
							: {
									requireInRange: policy.lp.requireInRange,
									...(policy.lp.requireInRange
										? { maxSampleGapSeconds: policy.lp.maxSampleGapSeconds }
										: {}),
								}),
					}),
				}),
		fixtureKind: policy.fixtureKind,
		network: policy.network,
		revision: policy.revision,
		minimumSwapUsdCents: policy.minimumSwapUsdCents,
		maximumPriceAgeSeconds: policy.maximumPriceAgeSeconds,
		valuationSource: policy.valuationSource,
		valuationVersion: policy.valuationVersion,
	});
	return createPassportReader(configuration, pinnedPolicy);
}

function integer(value, label) {
	if (
		!["string", "number"].includes(typeof value) ||
		!/^(0|[1-9][0-9]*)$/.test(String(value)) ||
		!Number.isSafeInteger(Number(value))
	) {
		throw new Error(`Passport snapshot: invalid ${label}`);
	}
	return Number(value);
}

function rows(result, limit, label) {
	if (!Array.isArray(result?.rows) || result.rows.length > limit) {
		throw new Error(`Passport snapshot: incomplete or oversized ${label}`);
	}
	return result.rows;
}

function exactSeconds(row, prefix) {
	if (row[`${prefix}_exact`] !== true)
		throw new Error("Passport snapshot: timestamps must be exact seconds");
	return integer(row[`${prefix}_seconds`], prefix);
}

function linkTime(value) {
	// Do not silently truncate PostgreSQL microseconds through a JS Date driver.
	const ms = integer(value, "link milliseconds");
	if (ms > 8_640_000_000_000_000)
		throw new Error("Passport snapshot: invalid link time");
	return new Date(ms).toISOString();
}

/**
 * Dormant server-only reader. Pool must provide dedicated connections to the
 * same verified Devnet database containing both schemas, using a read role.
 * The caller owns startup/manifest verification; this is not a public API or
 * receipt of current chain trust. Results describe one historical DB snapshot.
 */
function createPassportReader(
	{
		pool,
		network,
		campaignId,
		programId,
		decoderVersion,
		startSlot,
		maxEvents = 10_000,
		maxTickSamples = 100_000,
		maxLinks = 20_000,
		includeSourceContext = false,
		// Opt-in for TEST data whose link times carry microseconds: round a link start UP and a link
		// end DOWN to the millisecond. That can only shrink attributed time, never extend it, so it
		// cannot credit an event that happened outside a link. Default stays exact-or-refuse.
		conservativeLinkTimes = false,
		// Trusted server composition: createPositionTimelineReader with the same
		// campaign/environment pins. Missing coverage leaves only LP unavailable.
		lpOwnershipReader = null,
		environment,
	},
	qualificationPolicy = null,
	positionEvidence = false,
) {
	if (typeof includeSourceContext !== "boolean")
		throw new TypeError("Passport snapshot: invalid context mode");
	if (typeof conservativeLinkTimes !== "boolean")
		throw new TypeError("Passport snapshot: invalid link rounding mode");
	const pins = includeSourceContext ? structuredClone(environment) : null;
	if (includeSourceContext) {
		assertPassportId(pins?.environmentId);
		if (
			!qualificationPolicy ||
			pins.network !== "DEVNET" ||
			!/^[a-f0-9]{64}$/.test(pins.manifestSha256)
		)
			throw new TypeError(
				"Passport snapshot: qualified context needs dedicated Devnet pins",
			);
	}
	if (
		network !== "DEVNET" ||
		typeof pool?.connect !== "function" ||
		[campaignId, programId, decoderVersion].some(
			(value) => typeof value !== "string" || !value.trim(),
		) ||
		!Number.isSafeInteger(startSlot) ||
		startSlot < 0 ||
		!Number.isSafeInteger(maxEvents) ||
		maxEvents < 1 ||
		maxEvents > 50_000 ||
		!Number.isSafeInteger(maxLinks) ||
		maxLinks < 1 ||
		maxLinks > 100_000 ||
		(positionEvidence && (maxEvents > 10_000 || maxLinks > 20_000))
	) {
		throw new TypeError(
			"Passport snapshot: pinned Devnet configuration and bounded limits required",
		);
	}
	return {
		async read(computedThroughSlot) {
			if (
				!Number.isSafeInteger(computedThroughSlot) ||
				computedThroughSlot < startSlot
			) {
				throw new RangeError("Passport snapshot: invalid computed slot");
			}
			const client = await pool.connect();
			let begun = false;
			let failed = false;
			try {
				await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
				begun = true;
				if (pins) {
					await client.query("SET LOCAL statement_timeout = '2500ms'");
					const identity = rows(
						await client.query(
							"SELECT network,genesis_hash,environment_id::text,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true",
						),
						1,
						"environment",
					)[0];
					if (
						identity?.network !== "DEVNET" ||
						identity.genesis_hash !==
							"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ||
						identity.environment_id !== pins.environmentId ||
						identity.manifest_sha256 !== pins.manifestSha256 ||
						identity.namespace !== "quest"
					)
						throw new Error("Passport snapshot: database identity differs");
				}
				const campaigns = rows(
					await client.query(
						`SELECT cluster, trunc(EXTRACT(EPOCH FROM starts_at))::text AS start_seconds,
					 EXTRACT(EPOCH FROM starts_at) = trunc(EXTRACT(EPOCH FROM starts_at)) AS start_exact,
					 trunc(EXTRACT(EPOCH FROM ends_at))::text AS end_seconds,
					 EXTRACT(EPOCH FROM ends_at) = trunc(EXTRACT(EPOCH FROM ends_at)) AS end_exact
					 FROM genesis.campaigns WHERE id = $1`,
						[campaignId],
					),
					1,
					"campaign",
				);
				if (campaigns.length !== 1 || campaigns[0].cluster !== "devnet")
					throw new Error("Passport snapshot: Devnet campaign missing");
				const startsAtSeconds = exactSeconds(campaigns[0], "start");
				const endsAtSeconds = exactSeconds(campaigns[0], "end");
				// Events do not store program IDs. Refuse multiple campaign cursors
				// rather than attributing another program's rows under this pin.
				const cursors = rows(
					await client.query(
						`SELECT program_id, decoder_version, next_slot::text,
					 reconciliation_start_slot::text, reconciled_through_slot::text
					 FROM genesis.indexer_cursors WHERE campaign_id = $1 LIMIT 2`,
						[campaignId],
					),
					1,
					"cursor",
				);
				const cursor = cursors[0];
				if (
					!cursor ||
					cursor.program_id !== programId ||
					cursor.decoder_version !== decoderVersion ||
					integer(cursor.reconciliation_start_slot, "start slot") !== startSlot
				) {
					throw new Error("Passport snapshot: cursor pins differ");
				}
				const nextSlot = integer(cursor.next_slot, "next slot");
				const reconciledThroughSlot = integer(
					cursor.reconciled_through_slot,
					"watermark",
				);
				if (
					nextSlot <= computedThroughSlot ||
					reconciledThroughSlot < computedThroughSlot ||
					reconciledThroughSlot >= nextSlot
				) {
					throw new Error("Passport snapshot: range is not fully reconciled");
				}
				const conflicts = rows(
					await client.query(
						`SELECT conflict.id FROM genesis.ingest_conflicts AS conflict
					 JOIN genesis.chain_events AS event ON event.id = conflict.existing_event_id
					 WHERE event.campaign_id = $1 AND event.slot BETWEEN $2 AND $3
					 AND conflict.resolution = 'open' LIMIT 1`,
						[campaignId, startSlot, computedThroughSlot],
					),
					1,
					"conflicts",
				);
				if (conflicts.length)
					throw new Error("Passport snapshot: open source conflict");
				// Fetch every requested event family, including other decoder versions
				// and events outside the campaign time window; validation precedes filtering.
				// Include unsupported LP close records so the projection refuses them.
				const eventFilter = positionEvidence
					? "event_kind <> 'swap'"
					: "event_kind = 'swap'";
				const eventRows = rows(
					await client.query(
						`SELECT id::text AS event_id, campaign_id, cluster, signature, instruction_index, event_index, event_kind,
					 slot::text, trunc(EXTRACT(EPOCH FROM block_time))::text AS block_seconds,
					 EXTRACT(EPOCH FROM block_time) = trunc(EXTRACT(EPOCH FROM block_time)) AS block_exact,
					 wallet, pool_address, position_address, payload, decoder_version, event_sha256
					 FROM genesis.chain_events WHERE campaign_id = $1 AND ${eventFilter}
					 AND slot BETWEEN $2 AND $3 ORDER BY slot, id LIMIT $4`,
						[campaignId, startSlot, computedThroughSlot, maxEvents + 1],
					),
					maxEvents,
					"events",
				);
				const events = eventRows.map((row) => ({
					decoderVersion: row.decoder_version,
					eventSha256: row.event_sha256,
					record: {
						campaignId: row.campaign_id,
						cluster: row.cluster,
						signature: row.signature,
						instructionIndex: integer(
							row.instruction_index,
							"instruction index",
						),
						eventIndex: integer(row.event_index, "event index"),
						eventKind: row.event_kind,
						slot: integer(row.slot, "event slot"),
						blockTimeSeconds: exactSeconds(row, "block"),
						wallet: row.wallet,
						poolAddress: row.pool_address,
						positionAddress: row.position_address,
						payload: row.payload,
					},
				}));
				const histories = new Map(
					events.map((event) => [
						event.record.wallet,
						{ wallet: event.record.wallet, links: [] },
					]),
				);
				if (histories.size) {
					const linkRows = rows(
						await client.query(
							`SELECT link.network, link.wallet, link.passport_id::text,
						 ${conservativeLinkTimes ? "ceil" : "trunc"}(EXTRACT(EPOCH FROM link.linked_at) * 1000)::bigint::text AS linked_ms,
						 trunc(EXTRACT(EPOCH FROM link.unlinked_at) * 1000)::bigint::text AS unlinked_ms,
						 EXTRACT(EPOCH FROM link.linked_at) * 1000 = trunc(EXTRACT(EPOCH FROM link.linked_at) * 1000) AS linked_exact,
						 link.unlinked_at IS NULL OR EXTRACT(EPOCH FROM link.unlinked_at) * 1000 = trunc(EXTRACT(EPOCH FROM link.unlinked_at) * 1000) AS unlinked_exact
						 FROM quest.wallet_links AS link WHERE link.network = 'DEVNET' AND link.wallet = ANY($1::text[])
						 ORDER BY link.wallet, link.linked_at, link.link_id LIMIT $2`,
							[[...histories.keys()], maxLinks + 1],
						),
						maxLinks,
						"wallet histories",
					);
					for (const row of linkRows) {
						if (
							!histories.has(row.wallet) ||
							(!conservativeLinkTimes &&
								(row.linked_exact !== true || row.unlinked_exact !== true))
						)
							throw new Error(
								"Passport snapshot: invalid or sub-millisecond link history",
							);
						histories.get(row.wallet).links.push({
							network: row.network,
							wallet: row.wallet,
							passportId: row.passport_id,
							linkedAt: linkTime(row.linked_ms),
							unlinkedAt:
								row.unlinked_ms === null ? null : linkTime(row.unlinked_ms),
						});
					}
				}
				const snapshot = {
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
					histories: [...histories.values()],
				};
				let evidence = positionEvidence
					? projectPassportPositionEvidence(snapshot)
					: projectPassportSwapEvidence(snapshot);
				if (qualificationPolicy) {
					const byId = new Map();
					for (let index = 0; index < eventRows.length; index++) {
						const id = eventId(eventRows[index].event_id);
						if (byId.has(id))
							throw new Error("Passport snapshot: duplicate stored event ID");
						byId.set(id, events[index]);
					}
					const valuationRows = byId.size
						? rows(
								await client.query(
									`SELECT chain_event_id::text AS event_id, value_usd_cents::text,
						 trunc(EXTRACT(EPOCH FROM price_observed_at))::text AS price_seconds,
						 EXTRACT(EPOCH FROM price_observed_at) = trunc(EXTRACT(EPOCH FROM price_observed_at)) AS price_exact,
						 valuation_source, valuation_version, price_evidence
						 FROM genesis.swap_valuations WHERE campaign_id = $1 AND chain_event_id = ANY($2::bigint[])
						 ORDER BY chain_event_id LIMIT $3`,
									[campaignId, [...byId.keys()], maxEvents + 1],
								),
								maxEvents,
								"valuations",
							)
						: [];
					const seenIds = new Set();
					const valuations = valuationRows.map((row) => {
						const id = eventId(row.event_id),
							event = byId.get(id);
						if (!event || seenIds.has(id))
							throw new Error(
								"Passport snapshot: unexpected or repeated valuation event ID",
							);
						seenIds.add(id);
						return {
							sourceKey: JSON.stringify(
								fingerprintGenesisEvent(event.record).identity,
							),
							eventSha256: event.eventSha256,
							valueUsdCents: row.value_usd_cents,
							priceObservedAtSeconds: exactSeconds(row, "price"),
							valuationSource: row.valuation_source,
							valuationVersion: row.valuation_version,
							priceEvidence: row.price_evidence,
						};
					});
					evidence = projectPassportSwapQualification({
						snapshot,
						policy: qualificationPolicy,
						valuations,
					});
				}
				if (qualificationPolicy?.lp) {
					// LP qualification is additive: if its valuations are incomplete the swap result stays
					// valid and the LP metric is reported unavailable (null), never a fabricated zero.
					let lp = null;
					try {
						const lpPolicy = qualificationPolicy.lp;
						if (!lpOwnershipReader || typeof lpOwnershipReader.read !== "function")
							throw new Error("LP historical ownership reader required");
						const ownership = await lpOwnershipReader.read({ endSlot: computedThroughSlot });
						if (ownership.trust !== "HISTORICAL_REPEATABLE_READ_SNAPSHOT" ||
							!pins || ownership.network !== "DEVNET" || ownership.endSlot !== computedThroughSlot ||
							ownership.campaignId !== campaignId ||
							ownership.coveredThroughSlot < computedThroughSlot ||
							ownership.sourceContext?.environmentId !== pins?.environmentId ||
							ownership.sourceContext?.manifestSha256 !== pins?.manifestSha256 ||
							!Array.isArray(ownership.intervalPositions))
							throw new Error("LP ownership pins or coverage differ");
						const lpClock = rows(
							await client.query(
								"SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS captured_ms",
							),
							1,
							"clock",
						)[0];
						const lpEvents = rows(
							await client.query(
								`SELECT id::text AS event_id, event_kind, pool_address, position_address,
								 (payload->>'tickLowerIndex')::integer AS tick_lower, (payload->>'tickUpperIndex')::integer AS tick_upper
								 FROM genesis.chain_events WHERE campaign_id = $1
								 AND event_kind IN ('liquidity_increase','liquidity_decrease')
								 AND pool_address = ANY($2::text[]) AND slot BETWEEN $3 AND $4
								 ORDER BY id LIMIT $5`,
								[campaignId, lpPolicy.featuredPools, startSlot, computedThroughSlot, maxEvents + 1],
							),
							maxEvents,
							"LP events",
						);
						const ids = lpEvents.map((row) => eventId(row.event_id));
						const lpSnapshots = ids.length
							? rows(
									await client.query(
										`SELECT chain_event_id::text AS event_id, position_address, pool_address, wallet,
										 (EXTRACT(EPOCH FROM effective_at) * 1000)::bigint::text AS effective_ms,
										 sequence::text AS sequence, value_usd_cents::text AS value,
										 valuation_source, valuation_version
										 FROM genesis.lp_value_snapshots WHERE campaign_id = $1
										 AND chain_event_id = ANY($2::bigint[]) ORDER BY chain_event_id LIMIT $3`,
										[campaignId, ids, maxEvents + 1],
									),
									maxEvents,
									"LP snapshots",
								)
							: [];
						// Range-aware mode needs where each featured pool's price was over time. A pool with no
						// samples yields no credited time; it never makes the metric unavailable.
						const tickSamples = lpPolicy.requireInRange
							? rows(
									await client.query(
										`SELECT pool_address, (EXTRACT(EPOCH FROM observed_at) * 1000)::bigint::text AS observed_ms,
										 tick_current_index
										 FROM quest.pool_tick_samples
										 WHERE network = 'DEVNET' AND pool_address = ANY($1::text[])
										 AND observed_at <= to_timestamp($2::bigint / 1000.0)
										 ORDER BY pool_address, observed_at, observed_slot LIMIT $3`,
										[lpPolicy.featuredPools, lpClock.captured_ms, maxTickSamples + 1],
									),
									maxTickSamples,
									"LP tick samples",
								).map((row) => ({
									poolAddress: row.pool_address,
									tMs: integer(row.observed_ms, "tick sample time"),
									tick: Number(row.tick_current_index),
								}))
							: undefined;
						lp = projectPassportLpQualification({
							events: lpEvents.map((row) => ({
								eventId: row.event_id,
								kind: row.event_kind,
								poolAddress: row.pool_address,
								positionAddress: row.position_address,
								tickLower: row.tick_lower === null ? null : Number(row.tick_lower),
								tickUpper: row.tick_upper === null ? null : Number(row.tick_upper),
							})),
							snapshots: lpSnapshots.map((row) => ({
								eventId: row.event_id,
								positionAddress: row.position_address,
								poolAddress: row.pool_address,
								wallet: row.wallet,
								effectiveMs: integer(row.effective_ms, "snapshot time"),
								sequence: row.sequence,
								valueUsdCents: row.value,
								valuationSource: row.valuation_source,
								valuationVersion: row.valuation_version,
							})),
							histories: ownership.histories.map((h) => ({ wallet: h.wallet, links: h.links.map((l) => ({
								passportId: l.passportId, linkedMs: Date.parse(l.linkedAt),
								unlinkedMs: l.unlinkedAt === null ? null : Date.parse(l.unlinkedAt),
							})) })),
							ownershipIntervals: ownership.intervalPositions.map((p) => ({
								positionAddress: p.positionAddress, intervals: p.intervals.map((i) => ({
									startMs: i.startsAtSeconds * 1000, endMs: i.endsAtSeconds * 1000,
									wallet: i.closed || i.liquidityRaw === "0" ? null : i.wallet,
								})),
							})),
							policy: lpPolicy,
							capturedAtMs: integer(lpClock?.captured_ms, "capture clock"),
							tickSamples,
						});
						lp.ownershipProof = ownership.inventoryProof ? {...ownership.inventoryProof, computedThroughSlot} : { campaignId, anchorSha256:ownership.anchorSha256,
							coverageRevision:String(ownership.coverageRevision), computedThroughSlot };
					} catch {
						lp = null;
					}
					evidence = { ...evidence, lp };
				}
				if (qualificationPolicy?.referrals === true) {
					// Additive like LP: an unavailable referral source leaves the referral metrics null, never zero.
					let referrals = null;
					// A failed statement aborts the whole transaction, so isolate it with a savepoint.
					await client.query("SAVEPOINT referral_source");
					try {
						const referralRows = rows(
							await client.query(
								`SELECT referrer_passport_id::text AS referrer, referred_passport_id::text AS referred,
								 ceil(EXTRACT(EPOCH FROM created_at) * 1000)::bigint::text AS created_ms
								 FROM quest.referrals WHERE network = 'DEVNET' ORDER BY created_at, referred_passport_id LIMIT $1`,
								[maxLinks + 1],
							),
							maxLinks,
							"referrals",
						);
						referrals = referralRows.map((row) => ({
							referrerPassportId: row.referrer,
							referredPassportId: row.referred,
							createdAtMs: integer(row.created_ms, "referral time"),
						}));
						await client.query("RELEASE SAVEPOINT referral_source");
					} catch {
						referrals = null;
						await client.query("ROLLBACK TO SAVEPOINT referral_source");
					}
					evidence = { ...evidence, referrals };
				}
				if (pins) {
					const clock = rows(
						await client.query(
							"SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS captured_ms",
						),
						1,
						"clock",
					)[0];
					const capturedMs = integer(clock?.captured_ms, "capture clock");
					if (capturedMs > 8640000000000000)
						throw new Error("Passport snapshot: clock overflow");
					evidence = {
						...evidence,
						sourceContext: {
							network: "DEVNET",
							environmentId: pins.environmentId,
							manifestSha256: pins.manifestSha256,
							programId,
							campaignId,
							decoderVersion,
							startSlot,
							computedThroughSlot,
							nextSlot,
							reconciledThroughSlot,
							startsAtSeconds,
							endsAtSeconds,
							capturedAt: new Date(capturedMs).toISOString(),
						},
					};
				}
				await client.query("COMMIT");
				begun = false;
				return evidence;
			} catch (error) {
				failed = true;
				if (begun) {
					try {
						await client.query("ROLLBACK");
					} catch {
						/* Preserve failure; discard connection below. */
					}
				}
				throw error;
			} finally {
				// node-postgres release(error) discards failed/aborted connections.
				client.release(
					failed
						? new Error("Passport snapshot transaction failed")
						: undefined,
				);
			}
		},
	};
}
