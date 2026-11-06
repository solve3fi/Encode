// Called only by the guarded disposable Passport PostgreSQL rehearsal.
import assert from "node:assert/strict";
import { transferEvidenceFixture } from "../../tests/fixtures/quest-position-ownership.mjs";
import {
	liquidityRangeFixture,
	timelineConnection,
	timelineExtension,
} from "../../tests/fixtures/quest-position-timeline.mjs";
import { createPositionBaselineAnchorStore } from "./position-baseline-anchor.mjs";
import { createPositionOwnershipEvidenceStore } from "./position-ownership-evidence-store.mjs";
import { timelineHash } from "./position-timeline-integrity.mjs";
import { previewPositionTimelineQuests } from "./position-timeline-quest-preview.mjs";
import {
	createPositionTimelinePublisher,
	createPositionTimelineReader,
} from "./position-timeline-service.mjs";

export async function rehearsePositionTimeline({
	connection,
	anchorPool,
	makePool,
	role,
	publicationRole,
}) {
	for (const selectedRole of [role, publicationRole])
		await connection.query(
			`GRANT SELECT ON quest.position_timeline_clocks,quest.position_timeline_ranges,quest.position_timeline_conflicts,quest.position_timeline_coverage TO "${selectedRole}"`,
		);
	await connection.query(
		`GRANT INSERT ON quest.position_timeline_clocks,quest.position_timeline_ranges,quest.position_timeline_conflicts,quest.position_timeline_coverage TO "${publicationRole}"`,
	);
	await connection.query(
		`GRANT UPDATE(covered_through_slot,last_range_start,last_range_sha256,revision,invalidation_reason) ON quest.position_timeline_coverage TO "${publicationRole}"`,
	);
	// The existing read role needs identity/anchor/source/conflicts before earlier
	// owner-specific tests grant them later in the parent rehearsal.
	await connection.query(
		`GRANT SELECT ON quest.environment_identity,quest.position_baseline_anchors,quest.position_ownership_evidence,quest.position_ownership_conflicts TO "${role}"`,
	);
	const readPool = makePool(role),
		writePool = makePool(publicationRole);
	const setup = async (name, opts = {}) => {
		const f = liquidityRangeFixture({
			campaignId: `timeline-${name}`,
			...opts,
		});
		const input = {
			...f.anchor,
			snapshots: f.anchor.evidence.map((e) => e.raw),
		};
		await createPositionBaselineAnchorStore({
			...input,
			pool: anchorPool,
		}).record(input);
		const publisher = createPositionTimelinePublisher({
			pool: writePool,
			anchor: f.anchor,
			connection: timelineConnection(f),
		});
		const reader = createPositionTimelineReader({
			pool: readPool,
			anchor: f.anchor,
		});
		return { f, publisher, reader };
	};
	const a = await setup("prefix"),
		race = await Promise.all([
			a.publisher.publish(a.f),
			a.publisher.publish(a.f),
		]);
	assert.equal(race.filter((r) => r.publicationChanged).length, 1);
	assert.equal(race[0].coverageRevision, "1");
	let result = await a.reader.read({ endSlot: 20 });
	assert.equal(result.positions[0].endSlotLiquidityRaw, "107");
	assert.equal(result.intervalPositions[0].intervals[0].liquidityRaw, "100");
	assert.equal(result.trust, "HISTORICAL_REPEATABLE_READ_SNAPSHOT");
	assert.equal(result.awardEligible, false);
	const next = timelineExtension(a.f);
	assert.equal(
		(
			await createPositionTimelinePublisher({
				pool: writePool,
				anchor: a.f.anchor,
				connection: timelineConnection(next),
			}).publish(next)
		).coveredThroughSlot,
		21,
	);
	result = await a.reader.read({ endSlot: 21 });
	assert.equal(result.positions[0].endSlotLiquidityRaw, "114");
	assert.equal(result.intervalPositions[0].intervals.length, 2);
	const historic = await a.reader.read({ endSlot: 20 });
	assert.equal(historic.positions[0].endSlotLiquidityRaw, "107");
	assert.equal(historic.endsAtSeconds, 1000);
	const skipped = {
		...next,
		startSlot: 22,
		endSlot: 24,
		producedSlots: [],
		blocks: [],
	};
	await createPositionTimelinePublisher({
		pool: writePool,
		anchor: a.f.anchor,
		connection: timelineConnection(skipped),
	}).publish(skipped);
	assert.equal((await a.reader.read({ endSlot: 24 })).endsAtSeconds, 1100);
	assert.equal((await a.publisher.publish(a.f)).publicationChanged, false); // old exact range retry
	const gap = timelineExtension(next, {
		slot: 26,
		time: 1200,
		signature: "gap",
	});
	await assert.rejects(
		createPositionTimelinePublisher({
			pool: writePool,
			anchor: a.f.anchor,
			connection: timelineConnection(gap),
		}).publish(gap),
		/contiguous/,
	);
	assert.equal((await a.reader.read({ endSlot: 24 })).coverageRevision, "3");
	const disconnected = timelineExtension(next, { slot: 25, time: 1200 });
	disconnected.blocks[0].block.parentSlot = 12;
	disconnected.blocks[0].block.previousBlockhash =
		"11111111111111111111111111111112";
	await assert.rejects(
		createPositionTimelinePublisher({
			pool: writePool,
			anchor: a.f.anchor,
			connection: timelineConnection(disconnected),
		}).publish(disconnected),
		/chain/,
	);
	const pruned = timelineConnection(a.f);
	pruned.getFirstAvailableBlock = async () => 13;
	await assert.rejects(
		createPositionTimelinePublisher({
			pool: writePool,
			anchor: a.f.anchor,
			connection: pruned,
		}).publish(a.f),
		/pruned/,
	);
	const wrongNetwork = timelineConnection(a.f);
	wrongNetwork.getGenesisHash = async () => "mainnet";
	await assert.rejects(
		createPositionTimelinePublisher({
			pool: writePool,
			anchor: a.f.anchor,
			connection: wrongNetwork,
		}).publish(a.f),
		/network/,
	);
	const absent = timelineConnection(a.f),
		getBlock = absent.getBlock;
	absent.getBlock = async (s, o) => (s === 20 ? null : getBlock(s, o));
	await assert.rejects(
		createPositionTimelinePublisher({
			pool: writePool,
			anchor: a.f.anchor,
			connection: absent,
		}).publish(a.f),
	);
	assert.equal((await a.reader.read({ endSlot: 24 })).coveredThroughSlot, 24);

	const changed = await setup("changed");
	// Late import of the same independently decoded NFT source is conservative
	// invalidation, followed by an exact full-prefix rebuild rather than quarantine.
	const matching = await setup("matching-import");
	matching.f.blocks[0].block.transactions = [
		transferEvidenceFixture().transactions[0],
	];
	await matching.publisher.publish(matching.f);
	const matchingStore = createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: matching.f.anchor,
	});
	const matchingInput = {
		slot: 20,
		blockTimeSeconds: 1000,
		transferTransactions: transferEvidenceFixture().transactions,
	};
	await matchingStore.record(matchingInput);
	await assert.rejects(matching.reader.read({ endSlot: 20 }), /coverage/);
	assert.equal(
		(await matching.publisher.publish(matching.f)).coverageRevision,
		"3",
	);
	await matchingStore.record(matchingInput);
	assert.equal(
		(await matching.reader.read({ endSlot: 20 })).coverageRevision,
		"3",
	);
	await changed.publisher.publish(changed.f);
	const different = liquidityRangeFixture({
		campaignId: changed.f.anchor.campaignId,
		delta: "8",
	});
	const changedPublisher = createPositionTimelinePublisher({
		pool: writePool,
		anchor: changed.f.anchor,
		connection: timelineConnection(different),
	});
	const bad = await Promise.all([
		changedPublisher.publish(different),
		changedPublisher.publish(different),
	]);
	assert(bad.every((r) => r.quarantined));
	assert.equal(
		Number(
			(
				await connection.query(
					"SELECT count(*) AS n FROM quest.position_timeline_conflicts WHERE campaign_id=$1",
					[changed.f.anchor.campaignId],
				)
			).rows[0].n,
		),
		1,
	);
	assert.equal(
		(await changed.publisher.publish(changed.f)).watermarkPublished,
		false,
	);
	await assert.rejects(changed.reader.read({ endSlot: 20 }));
	const changedClock = await setup("clock");
	await changedClock.publisher.publish(changedClock.f);
	const clockMismatch = createPositionTimelinePublisher({
		pool: writePool,
		anchor: changedClock.f.anchor,
		connection: timelineConnection(changedClock.f, [], { anchorTime: 901 }),
	});
	assert.equal(
		(await clockMismatch.publish(changedClock.f)).reason,
		"CHANGED_CLOCK",
	);
	await assert.rejects(changedClock.reader.read({ endSlot: 20 }));

	const late = await setup("late");
	await late.publisher.publish(late.f);
	const sourceStore = createPositionOwnershipEvidenceStore({
		pool: anchorPool,
		anchor: late.f.anchor,
	});
	const future = transferEvidenceFixture().transactions[0];
	future.slot = 25;
	future.blockTime = 1200;
	future.transaction.signatures[0] = "timeline-future";
	await sourceStore.record({
		slot: 25,
		blockTimeSeconds: 1200,
		transferTransactions: [future],
	});
	assert.equal((await late.reader.read({ endSlot: 20 })).coverageRevision, "1");
	let inserted = false;
	const lateReadPool = makePool(role, async (sql) => {
		if (!inserted && sql.includes("FROM quest.position_timeline_coverage")) {
			inserted = true;
			const tx = transferEvidenceFixture().transactions[0];
			tx.slot = 19;
			tx.blockTime = 999;
			tx.transaction.signatures[0] = "timeline-late";
			await sourceStore.record({
				slot: 19,
				blockTimeSeconds: 999,
				transferTransactions: [tx],
			});
		}
	});
	const stable = await createPositionTimelineReader({
		pool: lateReadPool,
		anchor: late.f.anchor,
	}).read({ endSlot: 20 });
	assert.equal(stable.coverageRevision, "1");
	assert.equal(stable.positions[0].endSlotLiquidityRaw, "107");
	await assert.rejects(late.reader.read({ endSlot: 20 }), /coverage/);
	assert.equal(
		(await late.publisher.publish(late.f)).reason,
		"LEGACY_SOURCE_CONFLICT",
	);
	await assert.rejects(late.reader.read({ endSlot: 20 }));

	const owner = "1111111111111111111111111111111A",
		id = "77777777-7777-4777-8777-777777777777";
	const links = await setup("links", {
		baselineOwnerWallet: owner,
		ownerWallet: owner,
	});
	await connection.query(
		"INSERT INTO quest.passports(network,passport_id) VALUES('DEVNET',$1)",
		[id],
	);
	await connection.query(
		"INSERT INTO quest.wallet_bindings(network,wallet,passport_id) VALUES('DEVNET',$1,$2)",
		[owner, id],
	);
	await connection.query(
		"INSERT INTO quest.wallet_links(network,wallet,passport_id,linked_at,link_evidence_sha256) VALUES('DEVNET',$1,$2,to_timestamp(950),repeat('a',64))",
		[owner, id],
	);
	await links.publisher.publish(links.f);
	let unlinked = false;
	const unlinkPool = makePool(role, async (sql) => {
		if (!unlinked && sql.includes("FROM quest.position_timeline_coverage")) {
			unlinked = true;
			await connection.query(
				"UPDATE quest.wallet_links SET unlinked_at=to_timestamp(995),unlink_evidence_sha256=repeat('b',64) WHERE wallet=$1 AND unlinked_at IS NULL",
				[owner],
			);
		}
	});
	const before = await createPositionTimelineReader({
		pool: unlinkPool,
		anchor: links.f.anchor,
	}).read({ endSlot: 20 });
	assert.equal(before.histories[0].links[0].unlinkedAt, null);
	const after = await links.reader.read({ endSlot: 20 });
	assert.equal(
		after.histories[0].links[0].unlinkedAt,
		new Date(995000).toISOString(),
	);
	const policy = {
		network: "DEVNET",
		fixtureKind: "SYNTHETIC_DEVNET",
		revision: 1,
		valuationSource: "synthetic-oracle",
		valuationVersion: "test-1",
		maximumPriceAgeSeconds: 1000,
		featuredPools: [links.f.anchor.evidence[0].observation.poolAddress],
		minimumPoolUsdCents: "1000",
	};
	const value = (s) =>
		s.intervalPositions.flatMap((p) =>
			p.intervals
				.filter((i) => i.liquidityRaw !== "0")
				.map((i) => ({
					fixtureKind: "SYNTHETIC_DEVNET",
					sourceKey: i.sourceKey,
					positionAddress: p.positionAddress,
					liquidityRaw: i.liquidityRaw,
					intervalSha256: timelineHash(i),
					valueUsdCents: "2500",
					priceObservedAtSeconds: i.startsAtSeconds,
					valuationSource: policy.valuationSource,
					valuationVersion: policy.valuationVersion,
				})),
		);
	const previewBefore = previewPositionTimelineQuests({
			snapshot: before,
			policy,
			valuations: value(before),
		}),
		previewAfter = previewPositionTimelineQuests({
			snapshot: after,
			policy,
			valuations: value(after),
		});
	assert.equal(
		previewBefore.metrics.passports[0].qualifyingMilliseconds,
		"50000",
	);
	assert.equal(
		previewAfter.metrics.passports[0].qualifyingMilliseconds,
		"45000",
	);
	assert.equal(
		previewAfter.previews[0].quests.find((q) => q.id === "first-featured-pool")
			.status,
		"provisional",
	);
	assert.equal(
		previewAfter.previews[0].quests.find((q) => q.id === "mint-devnet-pass")
			.status,
		"unavailable",
	);
	assert.equal(
		Number(
			(await connection.query("SELECT count(*) AS n FROM quest.xp_events"))
				.rows[0].n,
		),
		0,
	);

	// A committed later conflict is invisible to a historical in-progress
	// snapshot and must make the next read refuse.
	let conflicted = false;
	const conflictPool = makePool(role, async (sql) => {
		if (!conflicted && sql.includes("FROM quest.position_timeline_coverage")) {
			conflicted = true;
			await connection.query(
				"INSERT INTO quest.position_timeline_conflicts(campaign_id,start_slot,end_slot,expected_sha256,observed_sha256,reason_code) VALUES($1,13,20,repeat('b',64),repeat('c',64),'CHANGED_RANGE')",
				[links.f.anchor.campaignId],
			);
		}
	});
	assert.equal(
		(
			await createPositionTimelineReader({
				pool: conflictPool,
				anchor: links.f.anchor,
			}).read({ endSlot: 20 })
		).coverageRevision,
		"1",
	);
	await assert.rejects(links.reader.read({ endSlot: 20 }));

	const preciseOwner = "1111111111111111111111111111111B",
		precise = await setup("precision", {
			baselineOwnerWallet: preciseOwner,
			ownerWallet: preciseOwner,
		});
	await connection.query(
		"INSERT INTO quest.wallet_bindings(network,wallet,passport_id) VALUES('DEVNET',$1,$2)",
		[preciseOwner, id],
	);
	await connection.query(
		"INSERT INTO quest.wallet_links(network,wallet,passport_id,linked_at,link_evidence_sha256) VALUES('DEVNET',$1,$2,to_timestamp(950.000001),repeat('a',64))",
		[preciseOwner, id],
	);
	await precise.publisher.publish(precise.f);
	await assert.rejects(precise.reader.read({ endSlot: 20 }), /precision/);
	for (const table of [
		"position_timeline_clocks",
		"position_timeline_ranges",
		"position_timeline_conflicts",
	])
		for (const command of [
			`UPDATE quest.${table} SET campaign_id=campaign_id`,
			`DELETE FROM quest.${table}`,
			`TRUNCATE quest.${table} CASCADE`,
		])
			await assert.rejects(connection.query(command), /immutable/);
	await assert.rejects(
		connection.query(
			"UPDATE quest.position_timeline_coverage SET anchor_sha256=repeat('b',64)",
		),
		/anchor|pins/,
	);
	const signal = () => {
		let resolve;
		const promise = new Promise((r) => {
			resolve = r;
		});
		return { promise, resolve };
	};
	const bounded = async (promise) => {
		let timer;
		try {
			return await Promise.race([
				promise,
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("timeline race timed out")),
						30000,
					);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	};
	for (const first of ["publication", "source"]) {
		const raceFixture = await setup(`lock-order-${first}`),
			held = signal(),
			release = signal(),
			attempted = signal();
		let paused = false;
		const actorPool =
			first === "publication"
				? makePool(publicationRole, async (sql) => {
						if (!paused && sql.startsWith("SELECT pg_advisory_xact_lock")) {
							paused = true;
							held.resolve();
							await bounded(release.promise);
						}
					})
				: null;
		// The source role has no new coverage SELECT/UPDATE permission. Wrap its
		// existing pool to pause after acquiring the campaign lock instead.
		const sourceActorPool = {
			async connect() {
				const c = await anchorPool.connect();
				return {
					async query(sql, params) {
						const r = await c.query(sql, params);
						if (
							!paused &&
							sql.startsWith("INSERT INTO quest.position_ownership_evidence")
						) {
							paused = true;
							held.resolve();
							await bounded(release.promise);
						}
						return r;
					},
					release: (e) => c.release(e),
				};
			},
		};
		const peerBase = first === "publication" ? anchorPool : writePool;
		const peerPool = {
			async connect() {
				const c = await peerBase.connect();
				return {
					query(sql, params) {
						if (
							sql.startsWith(
								first === "publication"
									? "INSERT INTO quest.position_ownership_evidence"
									: "SELECT pg_advisory_xact_lock",
							)
						)
							attempted.resolve();
						return c.query(sql, params);
					},
					release: (e) => c.release(e),
				};
			},
		};
		const tx = transferEvidenceFixture().transactions[0];
		tx.slot = 19;
		tx.blockTime = 999;
		tx.transaction.signatures[0] = `timeline-lock-${first}`;
		const sourceInput = {
			slot: 19,
			blockTimeSeconds: 999,
			transferTransactions: [tx],
		};
		const actor =
			first === "publication"
				? createPositionTimelinePublisher({
						pool: actorPool,
						anchor: raceFixture.f.anchor,
						connection: timelineConnection(raceFixture.f),
					}).publish(raceFixture.f)
				: createPositionOwnershipEvidenceStore({
						pool: sourceActorPool,
						anchor: raceFixture.f.anchor,
					}).record(sourceInput);
		actor.catch(() => held.resolve());
		await bounded(held.promise);
		const peer =
			first === "publication"
				? createPositionOwnershipEvidenceStore({
						pool: peerPool,
						anchor: raceFixture.f.anchor,
					}).record(sourceInput)
				: createPositionTimelinePublisher({
						pool: peerPool,
						anchor: raceFixture.f.anchor,
						connection: timelineConnection(raceFixture.f),
					}).publish(raceFixture.f);
		peer.catch(() => attempted.resolve());
		let waitError;
		try {
			await bounded(attempted.promise);
		} catch (error) {
			waitError = error;
		} finally {
			release.resolve();
		}
		const outcomes = await bounded(Promise.allSettled([actor, peer]));
		if (waitError) throw waitError;
		for (const outcome of outcomes)
			if (outcome.status === "rejected") throw outcome.reason;
		const results = outcomes.map((outcome) => outcome.value);
		if (first === "publication")
			assert.equal(results[0].watermarkPublished, true);
		else assert.equal(results[1].reason, "LEGACY_SOURCE_CONFLICT");
		await assert.rejects(raceFixture.reader.read({ endSlot: 20 }));
		if (first === "publication") {
			const row = (
				await connection.query(
					"SELECT covered_through_slot,invalidation_reason FROM quest.position_timeline_coverage WHERE campaign_id=$1",
					[raceFixture.f.anchor.campaignId],
				)
			).rows[0];
			assert.equal(row.covered_through_slot, null);
			assert.equal(row.invalidation_reason, "LATE_EVIDENCE");
		}
	}
	const denied = await readPool.connect();
	try {
		for (const command of [
			"INSERT INTO quest.position_timeline_clocks DEFAULT VALUES",
			"INSERT INTO quest.position_timeline_ranges DEFAULT VALUES",
			"INSERT INTO quest.position_timeline_conflicts DEFAULT VALUES",
			"UPDATE quest.position_timeline_coverage SET revision=revision",
			"DELETE FROM quest.position_timeline_ranges",
		])
			await assert.rejects(denied.query(command), /permission denied/);
	} finally {
		denied.release();
	}
	console.log(
		"Position timeline: concurrent publication, full-prefix replay, immutable proofs/clock, quarantine, late evidence, stable conflict/unlink snapshots, precision, test-only Quest preview and restricted roles passed.",
	);
}
