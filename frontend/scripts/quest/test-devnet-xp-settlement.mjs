import assert from "node:assert/strict";
import { test } from "node:test";
import { runSettlementRound } from "./devnet-xp-settlement.mjs";

const qualification = (rows) => ({
	computedThroughSlot: 42,
	passports: rows.map(([passportId, qualifyingSwaps]) => ({
		passportId,
		qualifyingSwaps,
	})),
});
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fixture({ rows, read, reserve, settleVoting, readPauses }) {
	const logs = [];
	const reserved = [];
	const provider = { read: read ?? (async () => qualification(rows)) };
	const store = {
		reserve:
			reserve ??
			(async (input) => {
				reserved.push(input);
				return { created: 1 };
			}),
	};
	return {
		logs,
		reserved,
		run: () =>
			runSettlementRound({
				provider,
				store,
				calendarCampaignId: "calendar",
				settleVoting,
				readPauses,
				log: (entry) => logs.push(entry),
			}),
	};
}

test("only Passports with a qualifying swap are settled, with the checked qualification", async () => {
	const f = fixture({ rows: [[A, 4], [B, 0], [C, 1]] });
	const summary = await f.run();
	assert.deepEqual(
		f.reserved.map((r) => r.passportId),
		[A, C],
	);
	assert.ok(f.reserved.every((r) => r.campaignId === "calendar"));
	assert.ok(f.reserved.every((r) => r.qualification.computedThroughSlot === 42));
	assert.equal(summary.status, "ok");
	assert.equal(summary.passports, 2);
	assert.equal(summary.receiptsCreated, 2);
	assert.equal(summary.failed, 0);
});

test("an unavailable or stale source settles nothing and reports it plainly", async () => {
	const f = fixture({
		read: async () => {
			throw new Error("private database detail");
		},
	});
	const summary = await f.run();
	assert.equal(summary.status, "source_unavailable");
	assert.equal(f.reserved.length, 0);
	assert.ok(!JSON.stringify(f.logs).includes("private database detail"));
});

test("one Passport failing does not stop the others and logs only a short prefix", async () => {
	const f = fixture({
		rows: [[A, 2], [B, 2], [C, 2]],
		reserve: async ({ passportId }) => {
			if (passportId === B) throw new Error("Weekly test budget exhausted");
			return { created: 1 };
		},
	});
	const summary = await f.run();
	assert.equal(summary.receiptsCreated, 2);
	assert.equal(summary.failed, 1);
	const failure = f.logs.find((l) => l.action === "xp_settler_passport_failed");
	assert.equal(failure.passport, B.slice(0, 8));
	assert.ok(!JSON.stringify(failure).includes(B));
});

test("a replay that creates nothing is a clean no-op", async () => {
	const f = fixture({ rows: [[A, 5]], reserve: async () => ({ created: 0 }) });
	const summary = await f.run();
	assert.equal(summary.receiptsCreated, 0);
	assert.equal(summary.failed, 0);
});

test("a Passport with only a qualifying LP interval is also settled, once, in sorted order", async () => {
	const f = fixture({
		read: async () => ({
			...qualification([[B, 1]]),
			lp: {
				passports: [
					{ passportId: C, pools: [{ poolAddress: "p", intervals: [[1, 2]] }] },
					{ passportId: B, pools: [{ poolAddress: "p", intervals: [[1, 2]] }] },
					{ passportId: A, pools: [] },
				],
			},
		}),
	});
	const summary = await f.run();
	assert.deepEqual(f.reserved.map((r) => r.passportId), [B, C]);
	assert.equal(summary.passports, 2);
});

test("LP unavailable (null) leaves swap settlement untouched", async () => {
	const f = fixture({ read: async () => ({ ...qualification([[A, 2]]), lp: null }) });
	await f.run();
	assert.deepEqual(f.reserved.map((r) => r.passportId), [A]);
});

test("a referrer with no activity of its own is still settled", async () => {
	const f = fixture({
		read: async () => ({
			...qualification([[A, 0]]),
			referrals: [{ referrerPassportId: B, referredPassportId: C, createdAtMs: 1 }],
		}),
	});
	const summary = await f.run();
	assert.deepEqual(f.reserved.map((r) => r.passportId).sort(), [B]);
	assert.equal(summary.passports, 1);
});

test("Voting XP is settled every round and reported, without changing the swap summary when absent", async () => {
	const calls = [];
	const f = fixture({
		rows: [[A, 1]],
		settleVoting: async () => {
			calls.push(1);
			return { settled: 3, currentEpoch: 7 };
		},
	});
	const summary = await f.run();
	assert.equal(calls.length, 1);
	assert.deepEqual(summary.voting, { settled: 3, currentEpoch: 7 });
	assert.equal(summary.receiptsCreated, 1);

	const without = await fixture({ rows: [[A, 1]] }).run();
	assert.ok(!("voting" in without));
});

test("Voting XP is settled even when the swap source is unavailable", async () => {
	const f = fixture({
		read: async () => {
			throw new Error("down");
		},
		settleVoting: async () => ({ settled: 1, currentEpoch: 2 }),
	});
	const summary = await f.run();
	assert.equal(summary.status, "source_unavailable");
	assert.deepEqual(summary.voting, { settled: 1, currentEpoch: 2 });
});

test("a Voting XP failure is logged briefly and never stops swap settlement", async () => {
	const f = fixture({
		rows: [[A, 2]],
		settleVoting: async () => {
			throw new Error("permission denied for table level_events: private detail ".repeat(10));
		},
	});
	const summary = await f.run();
	assert.equal(summary.status, "ok");
	assert.equal(summary.receiptsCreated, 1);
	assert.equal(summary.voting, null);
	const failure = f.logs.find((l) => l.action === "voting_settlement_failed");
	assert.ok(failure.error.length <= 120);
});

const released = { "weekly-xp": { paused: false }, "voting-xp": { paused: false } };

test("while weekly-xp is paused no receipt is recorded and the source is not even read", async () => {
	let reads = 0;
	const f = fixture({
		rows: [[A, 3]],
		read: async () => {
			reads++;
			return qualification([[A, 3]]);
		},
		readPauses: async () => ({ ...released, "weekly-xp": { paused: true, reason: "x" } }),
		settleVoting: async () => ({ settled: 0, currentEpoch: 2 }),
	});
	const summary = await f.run();
	assert.equal(summary.status, "weekly_xp_paused");
	assert.equal(f.reserved.length, 0);
	assert.equal(reads, 0);
	assert.deepEqual(summary.voting, { settled: 0, currentEpoch: 2 }, "voting still settles independently");
});

test("other switches do not stop weekly settlement, and releasing resumes it", async () => {
	const f = fixture({
		rows: [[A, 3]],
		readPauses: async () => ({ ...released, "voting-xp": { paused: true, reason: "y" } }),
	});
	const summary = await f.run();
	assert.equal(summary.status, "ok");
	assert.deepEqual(f.reserved.map((r) => r.passportId), [A]);
});

test("if the switches cannot be read the round proceeds, logs briefly, and the database still guards", async () => {
	const f = fixture({
		rows: [[A, 3]],
		readPauses: async () => {
			throw new Error("private detail ".repeat(20));
		},
	});
	const summary = await f.run();
	assert.equal(summary.status, "ok");
	assert.equal(f.reserved.length, 1);
	const failure = f.logs.find((l) => l.action === "pause_status_unavailable");
	assert.ok(failure.error.length <= 120);
});
