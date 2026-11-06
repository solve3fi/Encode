import { isDeepStrictEqual } from "node:util";
import { assertPassportId } from "./passport-id.mjs";
import { decodePositionLiquidityBlockRange } from "./position-liquidity-replay.mjs";
import { verifyOwnershipRangeAnchor } from "./position-ownership-block-range.mjs";
import { ownershipReconciliationRow } from "./position-ownership-reconciliation.mjs";
import {
	timelineFail as fail,
	timelineInteger as integer,
	TIMELINE_VERSION,
	timelineClock,
	timelineHash,
} from "./position-timeline-integrity.mjs";
import { createPositionTimelinePager, projectPositionTimelineIntervals } from "./position-timeline-projector.mjs";
import { passportAtEvent } from "./wallet-link-attribution.mjs";

const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
function rows(result, max) {
	if (!Array.isArray(result?.rows) || result.rows.length > max)
		fail("incomplete or oversized SQL result");
	return result.rows;
}
async function pins(client, anchor, p) {
	const env = rows(
		await client.query(
			"SELECT network,genesis_hash,manifest_sha256,namespace FROM quest.environment_identity WHERE singleton=true",
		),
		1,
	);
	if (
		env.length !== 1 ||
		!isDeepStrictEqual(env[0], {
			network: anchor.network,
			genesis_hash: GENESIS,
			manifest_sha256: anchor.manifestSha256,
			namespace: "quest",
		})
	)
		fail("database identity differs");
	const a = rows(
		await client.query(
			"SELECT evidence_bundle,evidence_set_sha256,inventory_sha256,network,program_id,layout_version,anchor_slot::text,manifest_sha256,position_count FROM quest.position_baseline_anchors WHERE campaign_id=$1",
			[anchor.campaignId],
		),
		1,
	);
	if (
		a.length !== 1 ||
		!isDeepStrictEqual(a[0], {
			evidence_bundle: anchor,
			evidence_set_sha256: p.evidenceSetSha256,
			inventory_sha256: p.inventorySha256,
			network: anchor.network,
			program_id: anchor.programId,
			layout_version: anchor.layoutVersion,
			anchor_slot: String(anchor.anchorSlot),
			manifest_sha256: anchor.manifestSha256,
			position_count: anchor.inventory.length,
		})
	)
		fail("stored anchor differs");
}
async function clockRow(client, anchor, p) {
	const a = rows(
		await client.query(
			"SELECT anchor_sha256,clock_sha256,clock_bundle FROM quest.position_timeline_clocks WHERE campaign_id=$1",
			[anchor.campaignId],
		),
		1,
	);
	if (!a.length) return null;
	const c = a[0].clock_bundle;
	if (
		a[0].anchor_sha256 !== p.evidenceSetSha256 ||
		a[0].clock_sha256 !== c?.clockSha256 ||
		!isDeepStrictEqual(
			c,
			timelineClock(anchor, {
				blockhash: c?.blockhash,
				blockTime: c?.blockTimeSeconds,
			}),
		)
	)
		fail("stored clock differs");
	return c;
}
async function coverage(client, anchor, p, lock = false) {
	const selected = rows(
		await client.query(
			`SELECT anchor_sha256,decoder_version,start_slot::text,covered_through_slot::text,last_range_start::text,last_range_sha256,revision::text,invalidation_reason FROM quest.position_timeline_coverage WHERE campaign_id=$1${lock ? " FOR UPDATE" : ""}`,
			[anchor.campaignId],
		),
		1,
	);
	if (!selected.length) return null;
	const c = selected[0];
	if (
		c.anchor_sha256 !== p.evidenceSetSha256 ||
		c.decoder_version !== TIMELINE_VERSION ||
		c.start_slot !== String(anchor.firstReplaySlot) ||
		typeof c.revision !== "string" ||
		!/^(0|[1-9][0-9]*)$/.test(c.revision)
	)
		fail("coverage pins or revision differ");
	if (c.covered_through_slot === null) {
		if (
			c.last_range_start !== null ||
			c.last_range_sha256 !== null ||
			![null, "LATE_EVIDENCE", "CONFLICT"].includes(c.invalidation_reason)
		)
			fail("incomplete invalidation");
	} else if (
		typeof c.covered_through_slot !== "string" ||
		String(integer(Number(c.covered_through_slot))) !==
			c.covered_through_slot ||
		typeof c.last_range_start !== "string" ||
		String(integer(Number(c.last_range_start))) !== c.last_range_start ||
		Number(c.last_range_start) < anchor.firstReplaySlot ||
		Number(c.last_range_start) > Number(c.covered_through_slot) ||
		Number(c.covered_through_slot) - Number(c.last_range_start) > 255 ||
		!/^[a-f0-9]{64}$/.test(c.last_range_sha256) ||
		c.invalidation_reason !== null
	)
		fail("malformed coverage");
	return c;
}
async function quarantined(client, anchor) {
	const r = rows(
		await client.query(
			"SELECT (EXISTS(SELECT 1 FROM quest.position_timeline_conflicts WHERE campaign_id=$1) OR EXISTS(SELECT 1 FROM quest.position_ownership_conflicts WHERE campaign_id=$1)) AS quarantined",
			[anchor.campaignId],
		),
		1,
	);
	if (r.length !== 1 || typeof r[0].quarantined !== "boolean")
		fail("incomplete quarantine state");
	return r[0].quarantined;
}
export function timelineRangeRow(r) {
	return {
		anchor_sha256: r.anchorSha256,
		decoder_version: r.decoderVersion,
		start_slot: String(r.startSlot),
		end_slot: String(r.endSlot),
		bundle_sha256: r.bundleSha256,
		evidence_bundle: r,
	};
}
async function ranges(client, anchor, end) {
	const selected = rows(
		await client.query(
			"SELECT anchor_sha256,decoder_version,start_slot::text,end_slot::text,bundle_sha256,evidence_bundle FROM quest.position_timeline_ranges WHERE campaign_id=$1 AND start_slot<=$2 ORDER BY start_slot LIMIT 65",
			[anchor.campaignId, String(end)],
		),
		64,
	);
	if (Buffer.byteLength(JSON.stringify(selected)) > 16_777_216)
		fail("stored prefix byte bound exceeded");
	return selected.map((r) => {
		if (!isDeepStrictEqual(r, timelineRangeRow(r.evidence_bundle)))
			fail("range typed metadata differs");
		return r.evidence_bundle;
	});
}
async function legacySources(client, anchor, selected, end, start = anchor.firstReplaySlot) {
	const stored = rows(
		await client.query(
			'SELECT source_key,evidence_sha256,evidence_record,network,program_id,decoder_version,anchor_sha256,signature,instruction_index::text,position_address,position_mint,slot::text,transaction_index::text,block_time_seconds::text,event_kind FROM quest.position_ownership_evidence WHERE campaign_id=$1 AND slot BETWEEN $2 AND $3 ORDER BY source_key COLLATE "C" LIMIT 4097',
			[anchor.campaignId, String(start), String(end)],
		),
		4096,
	);
	const expected = new Map(
		selected.flatMap((r) =>
			r.ownershipRange.observations.map((e) => {
				const row = ownershipReconciliationRow(e, r.anchorSha256);
				return [row.source_key, row];
			}),
		),
	);
	return {
		matches: stored.every((r) =>
			isDeepStrictEqual(r, expected.get(r.source_key)),
		),
		expectedSha256: timelineHash([...expected.values()]),
		observedSha256: timelineHash(stored),
	};
}

async function rangeAt(client,anchor,start) {
	const selected=rows(await client.query(
		"SELECT anchor_sha256,decoder_version,start_slot::text,end_slot::text,bundle_sha256,evidence_bundle FROM quest.position_timeline_ranges WHERE campaign_id=$1 AND start_slot=$2 LIMIT 2",
		[anchor.campaignId,String(start)]),1);
	if (!selected.length) return null;
	if (!isDeepStrictEqual(selected[0],timelineRangeRow(selected[0].evidence_bundle))) fail("range typed metadata differs");
	return selected[0].evidence_bundle;
}

// No raw-prefix array or caller-provided checkpoint. SQL checks full-prefix
// identities with bounded work_mem; pages are verified and folded in process.
async function pagedTimeline(client,anchor,clock,throughSlot,endSlot=throughSlot) {
	await client.query("SET LOCAL work_mem='8MB'");
	const identity=rows(await client.query(`WITH selected AS (
	 SELECT evidence_bundle FROM quest.position_timeline_ranges WHERE campaign_id=$1 AND start_slot<=$2
	), signatures AS (
	 SELECT tx->>'signature' AS signature FROM selected,
	 jsonb_array_elements(evidence_bundle->'ownershipRange'->'blocks') b,
	 jsonb_array_elements(b->'transactions') tx
	), mutations AS (
	 SELECT jsonb_build_array(e->'record'->>'signature',e->'record'->>'instructionIndex',e->'record'->>'positionAddress') AS identity
	 FROM selected,jsonb_array_elements((evidence_bundle->'ownershipRange'->'observations') || (evidence_bundle->'liquidityObservations')) e
	) SELECT EXISTS(SELECT 1 FROM signatures GROUP BY signature HAVING count(*)>1)
	 OR EXISTS(SELECT 1 FROM mutations GROUP BY identity HAVING count(*)>1) AS duplicate`,[anchor.campaignId,String(throughSlot)]),1);
	if (identity.length!==1 || identity[0].duplicate!==false) fail("duplicate full-prefix transaction or mutation identity");
	const assertGlobalIdentities=({endSlot:requested})=>{if(requested>throughSlot) fail("unverified identity prefix");};
	const verifier=createPositionTimelinePager({anchor,clock,assertGlobalIdentities});
	const projector=endSlot===throughSlot ? verifier : createPositionTimelinePager({anchor,clock,assertGlobalIdentities});
	let after=anchor.firstReplaySlot-1,lastRange=null,result=null,count=0;
	const intervalPositions=new Map();
	while(after<throughSlot) {
		const pageRows=rows(await client.query(
			"SELECT anchor_sha256,decoder_version,start_slot::text,end_slot::text,bundle_sha256,evidence_bundle FROM quest.position_timeline_ranges WHERE campaign_id=$1 AND start_slot>$2 AND start_slot<=$3 ORDER BY quest.position_timeline_ranges.start_slot LIMIT 16",
			[anchor.campaignId,String(after),String(throughSlot)]),16);
		if (!pageRows.length || Buffer.byteLength(JSON.stringify(pageRows))>16_777_216) fail("missing or oversized history page");
		const page=pageRows.map(row=>{if(!isDeepStrictEqual(row,timelineRangeRow(row.evidence_bundle))) fail("range typed metadata differs");return row.evidence_bundle;});
		lastRange=page.at(-1);
		const verified=await verifier.append({ranges:page,endSlot:Math.min(throughSlot,lastRange.endSlot)});
		const legacy=await legacySources(client,anchor,page,lastRange.endSlot,page[0].startSlot);
		if(!legacy.matches) {
			const error=new Error("Position timeline: legacy source conflicts with paged timeline");
			error.reason="LEGACY_SOURCE_CONFLICT";error.expectedSha256=legacy.expectedSha256;error.observedSha256=legacy.observedSha256;throw error;
		}
		if(after<endSlot) {
			result=projector===verifier ? verified : await projector.append({ranges:page,endSlot:Math.min(endSlot,lastRange.endSlot)});
			for(const position of result.intervalPositions) {
				const accumulated=intervalPositions.get(position.positionAddress) ?? {...position,intervals:[]};
				for(const interval of position.intervals) {
					const last=accumulated.intervals.at(-1);
					if(last && last.endsAtSeconds===interval.startsAtSeconds && last.wallet===interval.wallet &&
						last.liquidityRaw===interval.liquidityRaw && last.closed===interval.closed) last.endsAtSeconds=interval.endsAtSeconds;
					else {accumulated.intervals.push({...interval});if(++count>20000) fail("paged interval bound exceeded");}
				}
				intervalPositions.set(position.positionAddress,accumulated);
			}
		}
		after=lastRange.endSlot;
	}
	if(!result || lastRange.endSlot!==throughSlot) fail("coverage differs from complete paged prefix");
	const positions=[...intervalPositions.values()];
	for(const position of positions) for(const interval of position.intervals) {
		const {sourceKey,...body}=interval;
		interval.sourceKey=timelineHash({campaignId:anchor.campaignId,positionAddress:position.positionAddress,historySha256:result.historySha256,...body});
	}
	const output={...result,startsAtSeconds:clock.blockTimeSeconds,intervalPositions:positions};
	if(Buffer.byteLength(JSON.stringify(output))>16_777_216) fail("paged projection byte bound exceeded");
	return {result:output,lastRange};
}
async function transaction(pool, sql, work) {
	const client = await pool.connect();
	let begun = false,
		failed = false;
	try {
		await client.query(sql);
		begun = true;
		const result = await work(client);
		await client.query("COMMIT");
		begun = false;
		return result;
	} catch (error) {
		failed = true;
		if (begun) {
			try {
				await client.query("ROLLBACK");
			} catch {
				/* Preserve refusal. */
			}
		}
		throw error;
	} finally {
		client.release(
			failed ? new Error("Position timeline transaction failed") : undefined,
		);
	}
}
function configuration({ pool, anchor }) {
	if (typeof pool?.connect !== "function") fail("dedicated pool required");
	const p = verifyOwnershipRangeAnchor(anchor);
	return { pool, anchor: p.bundle, p };
}

/** Fresh finalized full-block decoding, append-only evidence and publication. */
export function createPositionTimelinePublisher(config) {
	const pagedHistory=config.pagedHistory ?? false;
	if(typeof pagedHistory!=="boolean") fail("invalid history paging mode");
	const { pool, anchor, p } = configuration(config),
		connection = config.connection;
	for (const method of [
		"getGenesisHash",
		"getSlot",
		"getFirstAvailableBlock",
		"getBlocks",
		"getBlock",
	])
		if (typeof connection?.[method] !== "function")
			fail("verified finalized connection required");
	return {
		async publish({ startSlot, endSlot }) {
			integer(startSlot);
			integer(endSlot);
			if (
				startSlot < anchor.firstReplaySlot ||
				endSlot < startSlot ||
				endSlot - startSlot > 255
			)
				fail("bounded post-anchor range required");
			if ((await connection.getGenesisHash()) !== GENESIS)
				fail("RPC network differs");
			if (
				integer(await connection.getSlot("finalized")) < endSlot ||
				integer(await connection.getFirstAvailableBlock()) > anchor.anchorSlot
			)
				fail("unfinalized or pruned anchor/range");
			const clock = timelineClock(
				anchor,
				await connection.getBlock(anchor.anchorSlot, {
					commitment: "finalized",
					transactionDetails: "none",
					maxSupportedTransactionVersion: 1,
					rewards: false,
				}),
			);
			const producedSlots = await connection.getBlocks(
				startSlot,
				endSlot,
				"finalized",
			);
			if (
				!Array.isArray(producedSlots) ||
				producedSlots.length > 256 ||
				producedSlots.some(
					(s, i) =>
						integer(s) < startSlot ||
						s > endSlot ||
						(i > 0 && s <= producedSlots[i - 1]),
				)
			)
				fail("invalid produced slots");
			const blocks = [];
			let transactionCount=0;
			for (const slot of producedSlots){
				const entry={
					slot,
					block: await connection.getBlock(slot, {
						commitment: "finalized",
						transactionDetails: "full",
						maxSupportedTransactionVersion: 1,
						rewards: false,
					}),
				};
				transactionCount+=entry.block?.transactions?.length??2049;
				if(transactionCount>2048)throw new Error("Liquidity replay: bounded full blocks required");
				blocks.push(entry);
			}
			const range = await decodePositionLiquidityBlockRange({
				anchor,
				startSlot,
				endSlot,
				producedSlots,
				blocks,
			});
			return transaction(
				pool,
				"BEGIN ISOLATION LEVEL READ COMMITTED",
				async (client) => {
					await client.query(
						"SELECT pg_advisory_xact_lock(hashtextextended($1,61746))",
						[anchor.campaignId],
					);
					await pins(client, anchor, p);
					await client.query(
						"INSERT INTO quest.position_timeline_clocks(campaign_id,anchor_sha256,clock_sha256,clock_bundle) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING",
						[
							anchor.campaignId,
							p.evidenceSetSha256,
							clock.clockSha256,
							JSON.stringify(clock),
						],
					);
					const existingClock = await clockRow(client, anchor, p);
					if (!existingClock) fail("clock insert missing");
					const conflict = async (reason, expected, observed) => {
						await client.query(
							"INSERT INTO quest.position_timeline_conflicts(campaign_id,start_slot,end_slot,expected_sha256,observed_sha256,reason_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
							[
								anchor.campaignId,
								String(startSlot),
								String(endSlot),
								expected,
								observed,
								reason,
							],
						);
						return {
							state: "TEST_ONLY_TIMELINE_QUARANTINED",
							awardEligible: false,
							quarantined: true,
							watermarkPublished: false,
							reason,
						};
					};
					if (!isDeepStrictEqual(existingClock, clock))
						return conflict(
							"CHANGED_CLOCK",
							existingClock.clockSha256,
							clock.clockSha256,
						);
					if (await quarantined(client, anchor))
						return {
							state: "TEST_ONLY_TIMELINE_QUARANTINED",
							awardEligible: false,
							quarantined: true,
							watermarkPublished: false,
						};
					let c = await coverage(client, anchor, p, true);
					const prior = pagedHistory ? [await rangeAt(client,anchor,startSlot)].filter(Boolean) : await ranges(
						client,
						anchor,
						Math.max(endSlot, Number(c?.covered_through_slot ?? 0)),
					);
					const existing = prior.find((r) => r.startSlot === startSlot);
					if (existing && !isDeepStrictEqual(existing, range))
						return conflict(
							"CHANGED_RANGE",
							existing.bundleSha256,
							range.bundleSha256,
						);
					const currentEnd =
						c?.covered_through_slot === null || !c
							? null
							: Number(c.covered_through_slot);
					if (currentEnd !== null) {
						const last = pagedHistory ? await rangeAt(client,anchor,Number(c.last_range_start)) : prior.filter((r) => r.startSlot <= currentEnd).at(-1);
						if (
							!last ||
							last.startSlot !== Number(c.last_range_start) ||
							last.endSlot !== currentEnd ||
							last.bundleSha256 !== c.last_range_sha256
						)
							fail("coverage does not match stored prefix");
					}
					const exactPublished =
						existing && currentEnd !== null && endSlot <= currentEnd;
					if (
						!exactPublished &&
						startSlot !==
							(currentEnd === null ? anchor.firstReplaySlot : currentEnd + 1)
					)
						fail("contiguous publication or anchor rebuild required");
					const target = exactPublished ? currentEnd : endSlot;
					const selected = prior.filter((r) => r.startSlot <= target);
					if (!existing) selected.push(range);
					selected.sort((a, b) => a.startSlot - b.startSlot);
					let result;
					if(pagedHistory) {
						if(!existing) {
							const r=timelineRangeRow(range);
							await client.query("INSERT INTO quest.position_timeline_ranges(campaign_id,anchor_sha256,decoder_version,start_slot,end_slot,bundle_sha256,evidence_bundle) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
								[anchor.campaignId,r.anchor_sha256,r.decoder_version,r.start_slot,r.end_slot,r.bundle_sha256,JSON.stringify(range)]);
						}
						try {result=(await pagedTimeline(client,anchor,clock,target)).result;}
						catch(error) {
							if(error.reason==="LEGACY_SOURCE_CONFLICT") return conflict(error.reason,error.expectedSha256,error.observedSha256);
							throw error;
						}
					} else result = projectPositionTimelineIntervals({
						anchor,
						ranges: selected,
						endSlot: target,
						clock,
					});
					const sources = pagedHistory ? {matches:true} : await legacySources(client, anchor, selected, target);
					if (!sources.matches)
						return conflict(
							"LEGACY_SOURCE_CONFLICT",
							sources.expectedSha256,
							sources.observedSha256,
						);
					if (!existing && !pagedHistory) {
						const r = timelineRangeRow(range);
						await client.query(
							"INSERT INTO quest.position_timeline_ranges(campaign_id,anchor_sha256,decoder_version,start_slot,end_slot,bundle_sha256,evidence_bundle) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
							[
								anchor.campaignId,
								r.anchor_sha256,
								r.decoder_version,
								r.start_slot,
								r.end_slot,
								r.bundle_sha256,
								JSON.stringify(range),
							],
						);
					}
					if (!c) {
						await client.query(
							"INSERT INTO quest.position_timeline_coverage(campaign_id,anchor_sha256,decoder_version,start_slot) VALUES($1,$2,$3,$4)",
							[
								anchor.campaignId,
								p.evidenceSetSha256,
								TIMELINE_VERSION,
								String(anchor.firstReplaySlot),
							],
						);
						c = await coverage(client, anchor, p, true);
						if (!c) fail("coverage initialization missing");
					}
					let revision = c.revision;
					if (!exactPublished) {
						const expected = BigInt(c.revision) + 1n;
						const updated = rows(
							await client.query(
								"UPDATE quest.position_timeline_coverage SET covered_through_slot=$2,last_range_start=$3,last_range_sha256=$4,revision=revision+1,invalidation_reason=NULL WHERE campaign_id=$1 RETURNING revision::text",
								[
									anchor.campaignId,
									String(endSlot),
									String(startSlot),
									range.bundleSha256,
								],
							),
							1,
						);
						if (
							updated.length !== 1 ||
							updated[0].revision !== expected.toString()
						)
							fail("incomplete publication revision");
						revision = updated[0].revision;
					}
					return {
						state: "TEST_ONLY_TIMELINE_PUBLISHED",
						awardEligible: false,
						quarantined: false,
						watermarkPublished: true,
						publicationChanged: !exactPublished,
						coveredThroughSlot: target,
						coverageRevision: revision,
						measuredThroughSeconds: result.measuredThroughSeconds,
					};
				},
			);
		},
	};
}

/** All source, trust, clock and wallet history reads share one stable snapshot. */
export function createPositionTimelineReader(config) {
	const pagedHistory=config.pagedHistory ?? false;
	if(typeof pagedHistory!=="boolean") fail("invalid history paging mode");
	const conservativeLinkTimes = config.conservativeLinkTimes ?? false;
	if (typeof conservativeLinkTimes !== "boolean") fail("invalid timeline link rounding mode");
	const { pool, anchor, p } = configuration(config);
	const environment = config.environment
		? structuredClone(config.environment)
		: null;
	if (environment) {
		assertPassportId(environment.environmentId);
		if (
			environment.network !== "DEVNET" ||
			environment.manifestSha256 !== anchor.manifestSha256
		)
			fail("timeline context pins differ");
	}
	return {
		async read({ endSlot }) {
			integer(endSlot);
			if (endSlot < anchor.firstReplaySlot) fail("post-anchor end required");
			return transaction(
				pool,
				"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
				async (client) => {
					if (environment) {
						await client.query("SET LOCAL statement_timeout='2500ms'");
						const identity = rows(
							await client.query(
								"SELECT environment_id::text FROM quest.environment_identity WHERE singleton=true",
							),
							1,
						);
						if (
							identity.length !== 1 ||
							identity[0].environment_id !== environment.environmentId
						)
							fail("timeline environment differs");
					}
					await pins(client, anchor, p);
					const clock = await clockRow(client, anchor, p),
						c = await coverage(client, anchor, p);
					if (
						!clock ||
						!c ||
						c.covered_through_slot === null ||
						Number(c.covered_through_slot) < endSlot
					)
						fail("current combined coverage required");
					if (await quarantined(client, anchor)) fail("campaign quarantined");
					const paged=pagedHistory ? await pagedTimeline(client,anchor,clock,Number(c.covered_through_slot),endSlot) : null;
					const selected = pagedHistory ? [paged.lastRange] : await ranges(
						client,
						anchor,
						Number(c.covered_through_slot),
					);
					const last = selected.at(-1);
					if (
						!last ||
						last.startSlot !== Number(c.last_range_start) ||
						last.endSlot !== Number(c.covered_through_slot) ||
						last.bundleSha256 !== c.last_range_sha256
					)
						fail("coverage does not match complete stored prefix");
					const legacy = pagedHistory ? {matches:true} : await legacySources(
						client,
						anchor,
						selected,
						Number(c.covered_through_slot),
					);
					if (!legacy.matches)
						fail("legacy source conflicts with covered timeline");
					const result = pagedHistory ? paged.result : projectPositionTimelineIntervals({
						anchor,
						ranges: selected,
						endSlot,
						clock,
					});
					const wallets = new Set(
						anchor.evidence.map((e) => e.observation.observedOwnerWallet),
					);
					for (const s of result.positions)
						for (const e of s.transitions)
							if (e.ownerWallet) wallets.add(e.ownerWallet);
					for(const position of result.intervalPositions) for(const interval of position.intervals)
						if(interval.wallet) wallets.add(interval.wallet);
					const histories = new Map(
						[...wallets].map((wallet) => [wallet, { wallet, links: [] }]),
					);
					const links = rows(
						await client.query(
							`SELECT network,wallet,passport_id::text, ${conservativeLinkTimes ? "ceil" : "trunc"}(EXTRACT(EPOCH FROM linked_at)*1000)::bigint::text AS linked_ms,trunc(EXTRACT(EPOCH FROM unlinked_at)*1000)::bigint::text AS unlinked_ms, EXTRACT(EPOCH FROM linked_at)*1000=trunc(EXTRACT(EPOCH FROM linked_at)*1000) AS linked_exact,unlinked_at IS NULL OR EXTRACT(EPOCH FROM unlinked_at)*1000=trunc(EXTRACT(EPOCH FROM unlinked_at)*1000) AS unlinked_exact FROM quest.wallet_links WHERE network='DEVNET' AND wallet=ANY($1::text[]) ORDER BY wallet,linked_at,link_id LIMIT 20001`,
							[[...wallets]],
						),
						20000,
					);
					const time = (v) => {
						if (
							typeof v !== "string" ||
							!/^(0|[1-9][0-9]*)$/.test(v) ||
							!Number.isSafeInteger(Number(v)) ||
							Number(v) > 8_640_000_000_000_000
						)
							fail("invalid link timestamp");
						return new Date(Number(v)).toISOString();
					};
					for (const link of links) {
						if (
							!histories.has(link.wallet) ||
							link.network !== "DEVNET" ||
							(!conservativeLinkTimes && (link.linked_exact !== true || link.unlinked_exact !== true))
						)
							fail("incomplete wallet history or timestamp precision");
						histories.get(link.wallet).links.push({
							network: link.network,
							wallet: link.wallet,
							passportId: link.passport_id,
							linkedAt: time(link.linked_ms),
							unlinkedAt:
								link.unlinked_ms === null ? null : time(link.unlinked_ms),
						});
					}
					for (const h of histories.values())
						passportAtEvent({
							network: "DEVNET",
							wallet: h.wallet,
							eventAt: new Date(clock.blockTimeSeconds * 1000).toISOString(),
							links: h.links,
						});
					let sourceContext;
					if (environment) {
						const capture = rows(
							await client.query(
								"SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS captured_ms",
							),
							1,
						)[0];
						const ms = Number(capture?.captured_ms);
						if (
							typeof capture?.captured_ms !== "string" ||
							!/^(0|[1-9][0-9]*)$/.test(capture.captured_ms) ||
							!Number.isSafeInteger(ms) ||
							ms < 0 ||
							ms > 8640000000000000
						)
							fail("invalid timeline capture");
						sourceContext = {
							network: "DEVNET",
							environmentId: environment.environmentId,
							manifestSha256: environment.manifestSha256,
							anchorSha256: p.evidenceSetSha256,
							capturedAt: new Date(ms).toISOString(),
						};
					}
					return {
						...result,
						trust: "HISTORICAL_REPEATABLE_READ_SNAPSHOT",
						coverageRevision: c.revision,
						coveredThroughSlot: Number(c.covered_through_slot),
						histories: [...histories.values()],
						...(sourceContext ? { sourceContext } : {}),
					};
				},
			);
		},
	};
}
