import assert from "node:assert/strict";
import { test } from "node:test";
import bs58 from "bs58";
import {
	MAX_GAUGE_VOTES,
	PROTOCOL_DISCRIMINATOR,
	USER_VOTE_DISCRIMINATOR,
	decodeProtocolHead,
	decodeUserVote,
	fetchEpochVotes,
	runVoteObservations,
} from "./devnet-vote-source.mjs";

// Real finalized Devnet accounts. The Protocol account is the current clean deployment's
// (epoch 0, started 2026-10-01 00:00 UTC). The UserVote is a real vote of the Oct 2 rehearsal program,
// which has the same account layout: epoch 4, 2,000,000,000,000,000 voting power, one gauge.
const REAL_PROTOCOL = Buffer.from("LSdlK3NIgyjxsavT0Zkq6/IabdT3/VMfS9Fcbnp6aSSdSI0XBARrYL/xzaJeVy1CoIihq8RcinYkZkiOhI31uSj/7P3ODQpQBAAAAAAAAAADAAAAAAAAAABQYxUOAQAAAAAAAAAAAAAAAAAAAAAAAICivWoAAAAAgDoJAAAAAAD9", "base64");
const REAL_VOTE = Buffer.from("iKPzysp8cDWsDU1JLFEkPWc07MLXtYlWUYUGjQjrT+dzE0gd3MrA+QQAAAAAAAAAAACNSf0aBwABAAAArtLN0CCo6kXo2QTx52Vj30VtexW3CPmfCwhbrdX6XL0AAI1J/RoHACM5wGoAAAAA/w==", "base64");
const REAL_VOTE_OWNER = "CactXBEjwPyvWdVAU4pg9H576f9UB7B4HHFzDD1qPwqJ";

function userVote({ owner = Buffer.alloc(32, 7), epoch = 3n, power = 5n, gauges = 2, time = 1_790_000_000n, pad = 100 } = {}) {
	const data = Buffer.alloc(8 + 32 + 8 + 8 + 4 + 40 * gauges + 8 + 1 + pad);
	USER_VOTE_DISCRIMINATOR.copy(data, 0);
	owner.copy(data, 8);
	data.writeBigUInt64LE(epoch, 40);
	data.writeBigUInt64LE(power, 48);
	data.writeUInt32LE(gauges, 56);
	data.writeBigInt64LE(time, 60 + 40 * gauges);
	return data;
}

test("decodes a real Protocol account", () => {
	const head = decodeProtocolHead(REAL_PROTOCOL);
	assert.equal(head.epochId, 0);
	assert.equal(head.epochStartTime.toISOString(), "2026-10-01T00:00:00.000Z");
});

test("decodes a real UserVote account: the owner, epoch, power and last vote time", () => {
	const vote = decodeUserVote(REAL_VOTE);
	assert.equal(vote.ownerWallet, REAL_VOTE_OWNER);
	assert.equal(vote.epochId, 4);
	assert.equal(vote.votingPower, "2000000000000000");
	assert.equal(vote.gaugeCount, 1);
	assert.equal(vote.voteTime.toISOString(), "2026-10-02T23:07:15.000Z");
});

test("decodes which gauges a vote backed and with what weight, skipping zero weights", () => {
	const real = decodeUserVote(REAL_VOTE);
	assert.equal(real.allocations.length, 1);
	assert.equal(real.allocations[0].gauge, "CmSNnBJV1j89bEb1JkVPmeaYj6F22oDFzuJo7AgdVrGt");
	const data = userVote({ gauges: 3 });
	Buffer.alloc(32, 9).copy(data, 60);
	data.writeBigUInt64LE(700n, 60 + 32);
	Buffer.alloc(32, 8).copy(data, 100);
	// the second entry keeps weight 0 and is skipped
	Buffer.alloc(32, 6).copy(data, 140);
	data.writeBigUInt64LE(300n, 140 + 32);
	const vote = decodeUserVote(data);
	assert.deepEqual(vote.allocations.map((x) => x.weight), ["700", "300"]);
	assert.equal(vote.allocations[0].gauge, bs58.encode(Buffer.alloc(32, 9)));
});

test("a round replaces each vote's allocations and a failing allocation write never blocks the observation", async () => {
	const data = userVote({ epoch: 2n, gauges: 2 });
	Buffer.alloc(32, 5).copy(data, 60);
	data.writeBigUInt64LE(11n, 92);
	const connection = chain({ epoch: 2, votesByEpoch: { 2: [{ address: "va", data }] } });
	const client = recorder();
	await runVoteObservations({ client, connection, programId: "ve-program", PublicKey: Key, epochsBack: 0 });
	const del = client.queries.filter((q) => /DELETE FROM quest.vote_allocations/.test(q.sql));
	const ins = client.queries.filter((q) => /INSERT INTO quest.vote_allocations/.test(q.sql));
	assert.equal(del.length, 1);
	assert.deepEqual(del[0].params, [2, "va"]);
	assert.equal(ins.length, 1);
	assert.deepEqual([ins[0].params[0], ins[0].params[1], ins[0].params[3]], [2, "va", "11"]);

	const failing = {
		queries: [],
		async query(sql, params) {
			this.queries.push({ sql, params });
			if (/vote_allocations/.test(sql)) throw new Error("relation does not exist");
			return { rowCount: 1 };
		},
	};
	const logs = [];
	const summary = await runVoteObservations({ client: failing, connection, programId: "ve-program", PublicKey: Key, epochsBack: 0, log: (v) => logs.push(v) });
	assert.equal(summary.recorded, 1);
	assert.ok(logs.some((l) => l.action === "vote_allocation_failed"));
	assert.match(failing.queries.at(-1).sql, /vote_epoch_heads/);
});

test("the time field follows the real vote list, however many gauges were voted", () => {
	for (const gauges of [1, 7, MAX_GAUGE_VOTES]) {
		const vote = decodeUserVote(userVote({ gauges, time: 1_790_123_456n }));
		assert.equal(vote.gaugeCount, gauges);
		assert.equal(vote.voteTime.getTime(), 1_790_123_456_000);
	}
});

test("returns the owner as base58 and a power too big for a JS number as an exact string", () => {
	const owner = Buffer.from(bs58.decode(REAL_VOTE_OWNER));
	const vote = decodeUserVote(userVote({ owner, power: 18_446_744_073_709_551_615n }));
	assert.equal(vote.ownerWallet, REAL_VOTE_OWNER);
	assert.equal(vote.votingPower, "18446744073709551615");
});

test("refuses foreign, truncated, empty and out-of-range accounts", () => {
	assert.throws(() => decodeUserVote(Buffer.alloc(200)), /Not a UserVote/);
	assert.throws(() => decodeUserVote(REAL_PROTOCOL), /Not a UserVote/);
	assert.throws(() => decodeUserVote(userVote({ gauges: 0 })), /gauge count/);
	assert.throws(() => decodeUserVote(userVote({ gauges: MAX_GAUGE_VOTES + 1 })), /gauge count/);
	assert.throws(() => decodeUserVote(userVote({ power: 0n })), /no voting power/);
	assert.throws(() => decodeUserVote(userVote({ gauges: 3 }).subarray(0, 100)), /truncated/);
	assert.throws(() => decodeProtocolHead(REAL_VOTE), /Not a ve Protocol/);
	assert.throws(() => decodeProtocolHead(Buffer.concat([PROTOCOL_DISCRIMINATOR, Buffer.alloc(20)])), /Not a ve Protocol/);
	assert.throws(() => decodeUserVote(userVote({ epoch: 2n ** 60n })), /out of range/);
});

class Key {
	constructor(value) {
		this.value = value;
	}
	equals(other) {
		return other.value === this.value;
	}
	toBase58() {
		return this.value;
	}
	static findProgramAddressSync() {
		return [new Key("protocol-pda")];
	}
}

function chain({ epoch, votesByEpoch, owner = new Key("ve-program") }) {
	const calls = [];
	const protocol = Buffer.from(REAL_PROTOCOL);
	protocol.writeBigUInt64LE(BigInt(epoch), 96);
	return {
		calls,
		async getAccountInfo(address, commitment) {
			calls.push(["account", address.value, commitment]);
			return { owner, data: protocol };
		},
		async getProgramAccounts(programKey, config) {
			const epochBytes = Buffer.from(bs58.decode(config.filters[1].memcmp.bytes));
			const wanted = Number(epochBytes.readBigUInt64LE(0));
			calls.push(["gpa", wanted, config.commitment, config.withContext, config.filters[0].memcmp.offset, config.filters[1].memcmp.offset]);
			return {
				context: { slot: 1000 + wanted },
				value: (votesByEpoch[wanted] ?? []).map(({ address, data }) => ({ pubkey: new Key(address), account: { data } })),
			};
		},
	};
}

function recorder() {
	const queries = [];
	return {
		queries,
		async query(sql, params) {
			queries.push({ sql, params });
			return { rowCount: sql.includes("vote_observations") ? 1 : 1 };
		},
	};
}

test("fetches one epoch with discriminator and epoch filters at finalized commitment, skipping junk", async () => {
	const good = userVote({ epoch: 3n });
	const wrongEpoch = userVote({ epoch: 9n });
	const junk = Buffer.alloc(300);
	const connection = chain({
		epoch: 3,
		votesByEpoch: { 3: [{ address: "vote-a", data: good }, { address: "vote-b", data: wrongEpoch }, { address: "vote-c", data: junk }] },
	});
	const result = await fetchEpochVotes({ connection, programKey: new Key("ve-program"), epochId: 3 });
	assert.deepEqual(connection.calls[0], ["gpa", 3, "finalized", true, 0, 40]);
	assert.equal(result.slot, 1003);
	assert.equal(result.votes.length, 1);
	assert.equal(result.votes[0].voteAccount, "vote-a");
	assert.equal(result.skipped, 2);
});

test("a round records votes for the last epochs and the current one, then the epoch head last", async () => {
	const connection = chain({
		epoch: 2,
		votesByEpoch: {
			1: [{ address: "v1", data: userVote({ epoch: 1n }) }],
			2: [{ address: "v2", data: userVote({ epoch: 2n }) }, { address: "v3", data: userVote({ epoch: 2n }) }],
		},
	});
	const client = recorder();
	const logs = [];
	const summary = await runVoteObservations({ client, connection, programId: "ve-program", PublicKey: Key, epochsBack: 1, log: (v) => logs.push(v) });
	assert.equal(summary.currentEpoch, 2);
	assert.equal(summary.epochs, 2);
	assert.equal(summary.seen, 3);
	assert.equal(summary.recorded, 3);
	const inserts = client.queries.filter((q) => q.sql.includes("vote_observations"));
	assert.equal(inserts.length, 3);
	assert.deepEqual(inserts.map((q) => q.params[1]), ["v1", "v2", "v3"]);
	assert.match(inserts[0].sql, /ON CONFLICT DO NOTHING/);
	const last = client.queries.at(-1);
	assert.match(last.sql, /vote_epoch_heads/);
	assert.deepEqual([last.params[0], last.params[1], last.params[2]], [2, "2026-10-01T00:00:00.000Z", 1002]);
	assert.equal(logs[0].action, "vote_observation_round");
});

test("epoch zero scans only epoch zero, and an empty epoch still records the head", async () => {
	const connection = chain({ epoch: 0, votesByEpoch: {} });
	const client = recorder();
	const summary = await runVoteObservations({ client, connection, programId: "ve-program", PublicKey: Key, epochsBack: 3 });
	assert.equal(summary.epochs, 1);
	assert.equal(summary.recorded, 0);
	assert.equal(client.queries.length, 1);
	assert.match(client.queries[0].sql, /vote_epoch_heads/);
});

test("refuses an account the ve program does not own, and writes nothing", async () => {
	const connection = chain({ epoch: 1, votesByEpoch: {}, owner: new Key("someone-else") });
	const client = recorder();
	await assert.rejects(
		runVoteObservations({ client, connection, programId: "ve-program", PublicKey: Key }),
		/Protocol account is unavailable/,
	);
	assert.equal(client.queries.length, 0);
});
