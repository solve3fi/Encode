import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { timelineConnection } from "../../tests/fixtures/quest-position-timeline.mjs";
import { weeklyLiquidityFixture } from "../../tests/fixtures/quest-weekly-liquidity.mjs";
import { createPositionBaselineAnchorStore } from "./position-baseline-anchor.mjs";
import { createPositionTimelinePublisher } from "./position-timeline-service.mjs";
import { compileQuestCalendar } from "./quest-calendar.mjs";
import {
	createWeeklyLiquidityProgressProvider,
	projectWeeklyLiquidityProgress,
} from "./quest-weekly-liquidity-progress.mjs";

export async function rehearseWeeklyLiquidity({
	connection,
	anchorPool,
	readPool,
	writePool,
	calendarApi,
}) {
	const { environment, plan } = calendarApi,
		now = new Date(
			(await connection.query("SELECT clock_timestamp() AS now")).rows[0].now,
		).getTime();
	const set = compileQuestCalendar(plan).weeks.find(
		(w) => Date.parse(w.startsAt) <= now && now < Date.parse(w.endsAt),
	);
	const passportId = "f1000000-0000-4000-8000-000000000001",
		wallet = new PublicKey(Buffer.alloc(32, 113)).toBase58();
	await connection.query(
		"INSERT INTO quest.passports(passport_id) VALUES($1)",
		[passportId],
	);
	await connection.query(
		"INSERT INTO quest.wallet_bindings(wallet,passport_id) VALUES($1,$2)",
		[wallet, passportId],
	);
	await connection.query(
		"INSERT INTO quest.wallet_links(wallet,passport_id,linked_at,link_evidence_sha256) VALUES($1,$2,$3,repeat('f',64))",
		[
			wallet,
			passportId,
			new Date(Date.parse(set.startsAt) - 100000).toISOString(),
		],
	);
	const f = await weeklyLiquidityFixture({
		set,
		passportId,
		wallet,
		firstOffset: 0,
		endOffset: Math.floor(now / 1000) - Date.parse(set.startsAt) / 1000,
	});
	const input = {
		...f.fixture.anchor,
		snapshots: f.fixture.anchor.evidence.map((e) => e.raw),
	};
	await createPositionBaselineAnchorStore({
		...input,
		pool: anchorPool,
	}).record(input);
	const blocks = {
		...f.fixture,
		endSlot: 21,
		producedSlots: [20, 21],
		blocks: [...f.fixture.blocks, ...f.next.blocks],
	};
	const publisher = createPositionTimelinePublisher({
		pool: writePool,
		anchor: f.fixture.anchor,
		connection: timelineConnection(blocks, [], { anchorTime: f.anchorTime }),
	});
	await publisher.publish({ startSlot: 13, endSlot: 20 });
	await publisher.publish({ startSlot: 21, endSlot: 21 });
	const provider = createWeeklyLiquidityProgressProvider({
		pool: readPool,
		anchor: f.fixture.anchor,
		environment,
		policy: f.packet.policy,
		resolveEndSlot: async () => 21,
		resolveValuations: async () => f.packet.valuations,
	});
	const packet = await provider.read(),
		capture = Date.parse(packet.snapshot.sourceContext.capturedAt);
	const progress = projectWeeklyLiquidityProgress({
		set,
		passportId,
		packet,
		sourcePins: provider.sourcePins,
		nowMs: capture,
	});
	assert.equal(progress.facts.metrics.featuredPoolsJoined, 1);
	assert.equal(progress.source.scope, "SELECTED_POSITIONS_ONLY");
	assert.equal(progress.source.awardEligible, false);
	// Role-bound reader obtains actual histories and timestamps; a mismatched
	// dedicated identity refuses before any output can reach private views.
	const wrong = createWeeklyLiquidityProgressProvider({
		pool: readPool,
		anchor: f.fixture.anchor,
		environment: {
			...environment,
			environmentId: "22222222-2222-4222-8222-222222222222",
		},
		policy: f.packet.policy,
		resolveEndSlot: async () => 21,
		resolveValuations: async () => f.packet.valuations,
	});
	await assert.rejects(wrong.read(), /environment differs/);
	await connection.query(
		"INSERT INTO quest.position_timeline_conflicts(campaign_id,start_slot,end_slot,expected_sha256,observed_sha256,reason_code) VALUES($1,13,20,repeat('b',64),repeat('c',64),'CHANGED_RANGE')",
		[f.fixture.anchor.campaignId],
	);
	await assert.rejects(provider.read(), /coverage|covered|quarantined/);
	assert.equal(
		Number(
			(await connection.query("SELECT count(*) AS n FROM quest.xp_events"))
				.rows[0].n,
		),
		0,
	);
	console.log(
		"Weekly liquidity: actual stored timeline, dedicated identity/capture, epoch new participation, selected scope, synthetic prices and coverage invalidation refusal passed.",
	);
}
