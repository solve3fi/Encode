import assert from "node:assert/strict";
import test from "node:test";
import { transferEvidenceFixture } from "../../tests/fixtures/quest-position-ownership.mjs";
import {
	liquidityRangeFixture,
	timelineExtension,
} from "../../tests/fixtures/quest-position-timeline.mjs";
import { decodePositionLiquidityBlockRange } from "./position-liquidity-replay.mjs";
import { timelineClock, timelineHash } from "./position-timeline-integrity.mjs";
import {
	projectPositionTimeline,
	projectPositionTimelineIntervals,
} from "./position-timeline-projector.mjs";

async function setup() {
	const f = liquidityRangeFixture();
	return {
		f,
		anchor: f.anchor,
		ranges: [await decodePositionLiquidityBlockRange(f)],
		endSlot: 20,
		clock: timelineClock(f.anchor, {
			blockhash: "11111111111111111111111111111112",
			blockTime: 900,
		}),
	};
}
function rehash(r) {
	const { bundleSha256, ...bundle } = r;
	r.bundleSha256 = timelineHash(bundle);
}
test("clock-bound intervals cover baseline until the first observed change", async () => {
	const f = await setup(),
		r = projectPositionTimelineIntervals(f);
	assert.equal(r.endsAtSeconds, 1000);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "107");
	assert.equal(r.intervalPositions[0].intervals[0].liquidityRaw, "100");
	assert.equal(r.awardEligible, false);
});
test("contiguous fragments preserve exact liquidity across batches", async () => {
	const f = await setup(),
		next = timelineExtension(f.f);
	f.ranges.push(await decodePositionLiquidityBlockRange(next));
	f.endSlot = 21;
	const r = projectPositionTimelineIntervals(f);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "114");
	assert.deepEqual(
		r.intervalPositions[0].intervals.map((i) => i.liquidityRaw),
		["100", "107"],
	);
});
test("historical cutoff excludes later state while checking the complete proof", async () => {
	const f = await setup();
	f.ranges.push(
		await decodePositionLiquidityBlockRange(timelineExtension(f.f)),
	);
	const r = projectPositionTimelineIntervals(f);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "107");
	assert.equal(r.positions[0].transitions.length, 1);
	assert.equal(r.endsAtSeconds, 1000);
});
test("cutoff before first produced block has zero measured duration", async () => {
	const f = await setup();
	f.endSlot = 19;
	const r = projectPositionTimelineIntervals(f);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "100");
	assert.deepEqual(r.intervalPositions[0].intervals, []);
	assert.equal(r.endsAtSeconds, 900);
});
test("all-skipped extension preserves the last observed time", async () => {
	const f = await setup(),
		next = timelineExtension(f.f, { slot: 21 });
	next.endSlot = 23;
	next.blocks = [];
	next.producedSlots = [];
	f.ranges.push(await decodePositionLiquidityBlockRange(next));
	f.endSlot = 23;
	assert.equal(projectPositionTimelineIntervals(f).endsAtSeconds, 1000);
});
test("equal block timestamps produce no invented intermediate duration", async () => {
	const f = await setup();
	f.ranges.push(
		await decodePositionLiquidityBlockRange(
			timelineExtension(f.f, { time: 1000 }),
		),
	);
	f.endSlot = 21;
	const r = projectPositionTimelineIntervals(f);
	assert.equal(r.intervalPositions[0].intervals.length, 1);
	assert.equal(r.positions[0].endSlotLiquidityRaw, "114");
});
test("transfer and same-block LP state become the next interval's owner", async () => {
	const raw = liquidityRangeFixture({
		ownerWallet: "11111111111111111111111111111113",
		tokenAccountAddress: "11111111111111111111111111111114",
	});
	raw.blocks[0].block.transactions.unshift(
		transferEvidenceFixture().transactions[0],
	);
	const f = {
		anchor: raw.anchor,
		ranges: [await decodePositionLiquidityBlockRange(raw)],
		endSlot: 21,
		clock: timelineClock(raw.anchor, {
			blockhash: "11111111111111111111111111111112",
			blockTime: 900,
		}),
	};
	const next = timelineExtension(raw);
	next.blocks[0].block.transactions = [];
	f.ranges.push(await decodePositionLiquidityBlockRange(next));
	const r = projectPositionTimelineIntervals(f);
	assert.equal(
		r.intervalPositions[0].intervals[1].wallet,
		"11111111111111111111111111111113",
	);
	assert.equal(r.intervalPositions[0].intervals[1].liquidityRaw, "107");
});
test("jsonb object ordering preserves bundle and source integrity", async () => {
	const f = await setup();
	const reverse = (v) =>
		Array.isArray(v)
			? v.map(reverse)
			: v && typeof v === "object"
				? Object.fromEntries(
						Object.entries(v)
							.reverse()
							.map(([k, x]) => [k, reverse(x)]),
					)
				: v;
	f.ranges = f.ranges.map(reverse);
	projectPositionTimelineIntervals(f);
});
for (const [label, alter] of [
	[
		"range hash",
		(f) => {
			f.ranges[0].bundleSha256 = "b".repeat(64);
		},
	],
	[
		"manifest clock",
		(f) => {
			f.clock.manifestSha256 = "b".repeat(64);
		},
	],
	[
		"clock block chain",
		(f) => {
			f.clock = timelineClock(f.anchor, {
				blockhash: "11111111111111111111111111111113",
				blockTime: 900,
			});
		},
	],
	[
		"clock time",
		(f) => {
			f.clock = timelineClock(f.anchor, {
				blockhash: f.clock.blockhash,
				blockTime: 1001,
			});
		},
	],
	[
		"requested gap",
		(f) => {
			f.endSlot = 21;
		},
	],
	[
		"prefix gap",
		(f) => {
			f.ranges[0].startSlot = 14;
			rehash(f.ranges[0]);
		},
	],
	[
		"wrong version",
		(f) => {
			f.ranges[0].decoderVersion = "other";
			rehash(f.ranges[0]);
		},
	],
	[
		"LP event hash",
		(f) => {
			f.ranges[0].liquidityObservations[0].eventSha256 = "b".repeat(64);
			rehash(f.ranges[0]);
		},
	],
	[
		"LP block ordinal",
		(f) => {
			f.ranges[0].liquidityObservations[0].transactionIndex = 1;
			rehash(f.ranges[0]);
		},
	],
	[
		"LP token account",
		(f) => {
			f.ranges[0].liquidityObservations[0].tokenAccountAddress =
				"11111111111111111111111111111115";
			rehash(f.ranges[0]);
		},
	],
	[
		"extra record",
		(f) => {
			f.ranges[0].liquidityObservations[0].record.extra = true;
			rehash(f.ranges[0]);
		},
	],
	[
		"missing block metadata",
		(f) => {
			f.ranges[0].ownershipRange.blocks = [];
			rehash(f.ranges[0]);
		},
	],
	[
		"failed transaction claim",
		(f) => {
			f.ranges[0].ownershipRange.blocks[0].transactions[0].failed = true;
			rehash(f.ranges[0]);
		},
	],
	[
		"duplicate mutation",
		(f) => {
			f.ranges[0].liquidityObservations.push(
				structuredClone(f.ranges[0].liquidityObservations[0]),
			);
			rehash(f.ranges[0]);
		},
	],
])
	test(`refuses ${label}`, async () => {
		const f = await setup();
		alter(f);
		assert.throws(() => projectPositionTimelineIntervals(f));
	});
test("range gap and cross-range parent/time mismatch refuse", async () => {
	for (const mutation of [
		(r) => {
			r.startSlot = 22;
		},
		(r) => {
			r.ownershipRange.blocks[0].previousBlockhash =
				"11111111111111111111111111111112";
		},
		(r) => {
			r.ownershipRange.blocks[0].blockTimeSeconds = 999;
			r.liquidityObservations[0].record.blockTimeSeconds = 999;
		},
	]) {
		const f = await setup(),
			r = await decodePositionLiquidityBlockRange(timelineExtension(f.f));
		mutation(r);
		rehash(r);
		f.ranges.push(r);
		f.endSlot = 21;
		assert.throws(() => projectPositionTimelineIntervals(f));
	}
});
test("interval construction requires an anchored clock", async () => {
	const f = await setup();
	delete f.clock;
	assert.throws(() => projectPositionTimelineIntervals(f), /clock/);
	assert.equal(projectPositionTimeline(f).clock, null);
});
test("oversized range count refuses without a truncated result", async () => {
	const f = await setup();
	f.ranges = Array(65).fill(f.ranges[0]);
	assert.throws(() => projectPositionTimeline(f), /bounded/);
});
