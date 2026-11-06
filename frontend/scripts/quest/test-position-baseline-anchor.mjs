import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { positionBaselineFixture } from "../../tests/fixtures/quest-position-baseline.mjs";
import {
	createPositionBaselineAnchorStore,
	preparePositionBaselineAnchor,
} from "./position-baseline-anchor.mjs";

function input() {
	const snapshot = positionBaselineFixture();
	return {
		network: "DEVNET",
		campaignId: "anchor-fixture",
		programId: snapshot.programId,
		layoutVersion: snapshot.layoutVersion,
		manifestSha256: "a".repeat(64),
		anchorSlot: snapshot.slot,
		inventory: [
			{
				positionAddress: snapshot.positionAccount.address,
				positionMint: snapshot.mintAccount.address,
				tokenAccountAddress: snapshot.tokenAccount.address,
			},
		],
		snapshots: [snapshot],
	};
}
test("anchor binds complete selected raw evidence at exact slot and starts replay next slot", () => {
	const result = preparePositionBaselineAnchor(input());
	assert.equal(result.bundle.anchorSlot, 12);
	assert.equal(result.bundle.firstReplaySlot, 13);
	assert.equal(result.bundle.inventoryCoverage, "SELECTED_POSITIONS_ONLY");
	assert.equal(result.bundle.ownershipCoverage, "POINT_IN_TIME");
	assert.equal(result.bundle.awardEligible, false);
	assert.deepEqual(result.bundle.evidence[0].raw, input().snapshots[0]);
	assert.deepEqual(
		preparePositionBaselineAnchor(structuredClone(input())),
		result,
	);
});
test("extra caller fields are excluded and hashes bind raw data and manifest pins", () => {
	const f = input();
	const original = preparePositionBaselineAnchor(f);
	f.snapshots[0].unrelatedMetadata = "do not persist";
	f.snapshots[0].mintAccount.unrelatedMetadata = "ignored";
	assert.deepEqual(preparePositionBaselineAnchor(f), original);
	f.manifestSha256 = "b".repeat(64);
	assert.notEqual(
		preparePositionBaselineAnchor(f).evidenceSetSha256,
		original.evidenceSetSha256,
	);
	const g = input();
	const bytes = Buffer.from(
		g.snapshots[0].positionAccount.dataBase64,
		"base64",
	);
	bytes[100] ^= 1;
	g.snapshots[0].positionAccount.dataBase64 = bytes.toString("base64");
	assert.notEqual(
		preparePositionBaselineAnchor(g).evidenceSetSha256,
		original.evidenceSetSha256,
	);
});

test("multi-position anchor hashes are invariant under inventory/snapshot order", () => {
	const f = input(),
		snapshot = positionBaselineFixture();
	const mint = new PublicKey("11111111111111111111111111111112");
	const position = Buffer.from(snapshot.positionAccount.dataBase64, "base64");
	mint.toBuffer().copy(position, 40);
	snapshot.positionAccount.dataBase64 = position.toString("base64");
	snapshot.positionAccount.address = PublicKey.findProgramAddressSync(
		[Buffer.from("position"), mint.toBuffer()],
		new PublicKey(snapshot.programId),
	)[0].toBase58();
	snapshot.mintAccount.address = mint.toBase58();
	const token = Buffer.from(snapshot.tokenAccount.dataBase64, "base64");
	mint.toBuffer().copy(token, 0);
	snapshot.tokenAccount.dataBase64 = token.toString("base64");
	snapshot.tokenAccount.address = "11111111111111111111111111111113";
	f.snapshots.push(snapshot);
	f.inventory.push({
		positionAddress: snapshot.positionAccount.address,
		positionMint: snapshot.mintAccount.address,
		tokenAccountAddress: snapshot.tokenAccount.address,
	});
	const prepared = preparePositionBaselineAnchor(f);
	f.inventory.reverse();
	f.snapshots.reverse();
	assert.deepEqual(preparePositionBaselineAnchor(f), prepared);
});
for (const [name, mutate, pattern] of [
	[
		"later snapshot",
		(f) => {
			f.snapshots[0].slot++;
		},
		/exact anchor slot/,
	],
	[
		"earlier snapshot",
		(f) => {
			f.snapshots[0].slot--;
		},
		/exact anchor slot/,
	],
	[
		"different program",
		(f) => {
			f.snapshots[0].programId = "11111111111111111111111111111111";
		},
		/pins/,
	],
	[
		"unfinalized",
		(f) => {
			f.snapshots[0].finality = "confirmed";
		},
		/pins/,
	],
	[
		"Mainnet",
		(f) => {
			f.network = "MAINNET";
		},
		/Devnet/,
	],
	[
		"missing manifest",
		(f) => {
			delete f.manifestSha256;
		},
		/manifest/,
	],
	[
		"replay slot overflow",
		(f) => {
			f.anchorSlot = Number.MAX_SAFE_INTEGER;
		},
		/slot/,
	],
	[
		"empty inventory",
		(f) => {
			f.inventory = [];
			f.snapshots = [];
		},
		/bounded/,
	],
	[
		"missing snapshot",
		(f) => {
			f.snapshots = [];
		},
		/complete/,
	],
	[
		"extra snapshot",
		(f) => {
			f.snapshots.push(f.snapshots[0]);
		},
		/complete/,
	],
	[
		"duplicate inventory",
		(f) => {
			f.inventory.push({ ...f.inventory[0] });
			f.snapshots.push(f.snapshots[0]);
		},
		/duplicate/,
	],
	[
		"inventory mint mismatch",
		(f) => {
			f.inventory[0].positionMint = "11111111111111111111111111111111";
		},
		/mismatched/,
	],
	[
		"inventory token mismatch",
		(f) => {
			f.inventory[0].tokenAccountAddress = "11111111111111111111111111111111";
		},
		/mismatched/,
	],
	[
		"oversized inventory",
		(f) => {
			f.inventory = Array(257).fill(f.inventory[0]);
			f.snapshots = Array(257).fill(f.snapshots[0]);
		},
		/bounded/,
	],
])
	test(`anchor refuses ${name}`, () => {
		const f = input();
		mutate(f);
		assert.throws(() => preparePositionBaselineAnchor(f), pattern);
	});

function harness({
	existing = null,
	identity = {},
	failOn = null,
	failRollback = false,
	onConnect = () => {},
} = {}) {
	const f = input(),
		calls = [],
		released = [];
	const client = {
		async query(sql, params) {
			calls.push({ sql, params });
			if (
				(failOn && sql.includes(failOn)) ||
				(failRollback && sql === "ROLLBACK")
			)
				throw new Error("fixture driver failure");
			if (sql.includes("FROM quest.environment_identity"))
				return {
					rows: [
						{
							network: "DEVNET",
							genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
							namespace: "quest",
							manifest_sha256: f.manifestSha256,
							...identity,
						},
					],
				};
			if (sql.startsWith("INSERT"))
				return { rows: existing ? [] : [{ campaign_id: f.campaignId }] };
			if (sql.includes("FROM quest.position_baseline_anchors"))
				return {
					rows: existing
						? [
								{
									network: f.network,
									program_id: f.programId,
									layout_version: f.layoutVersion,
									anchor_slot: String(f.anchorSlot),
									manifest_sha256: f.manifestSha256,
									position_count: 1,
									...existing,
								},
							]
						: [],
				};
			return { rows: [] };
		},
		release(error) {
			released.push(error);
		},
	};
	const pool = {
		async connect() {
			onConnect();
			return client;
		},
	};
	return {
		store: createPositionBaselineAnchorStore({ ...f, pool }),
		f,
		calls,
		released,
	};
}
test("store checks environment and performs one atomic parameterized insert", async () => {
	const h = harness();
	const result = await h.store.record(h.f);
	assert.equal(result.inserted, true);
	assert.equal(result.awardEligible, false);
	assert.equal(h.calls[0].sql, "BEGIN ISOLATION LEVEL READ COMMITTED");
	const inserted = h.calls.find((c) => c.sql.startsWith("INSERT"));
	assert.equal(inserted.params[4], "12");
	assert.deepEqual(JSON.parse(inserted.params[9]), result.bundle);
	assert.equal(h.calls.at(-1).sql, "COMMIT");
	assert.equal(h.released[0], undefined);
});

test("store persists prepared count/evidence even if caller mutates arrays during connection", async () => {
	let f;
	const h = harness({
		onConnect: () => {
			f.inventory.length = 0;
			f.snapshots.length = 0;
		},
	});
	f = h.f;
	const result = await h.store.record(f);
	assert.equal(result.bundle.inventory.length, 1);
	assert.equal(h.calls.find((c) => c.sql.startsWith("INSERT")).params[8], 1);
});

test("store refuses inconsistent stored metadata despite matching bundle and hashes", async () => {
	const p = preparePositionBaselineAnchor(input());
	const h = harness({
		existing: {
			evidence_bundle: p.bundle,
			inventory_sha256: p.inventorySha256,
			evidence_set_sha256: p.evidenceSetSha256,
			anchor_slot: "13",
		},
	});
	await assert.rejects(h.store.record(h.f), /conflicting immutable/);
});
test("identical stored bundle is idempotent; changed raw bundle is refused even with same hash fields", async () => {
	const p = preparePositionBaselineAnchor(input());
	const existing = {
		evidence_bundle: p.bundle,
		inventory_sha256: p.inventorySha256,
		evidence_set_sha256: p.evidenceSetSha256,
	};
	let h = harness({ existing });
	assert.equal((await h.store.record(h.f)).inserted, false);
	const changed = structuredClone(existing);
	changed.evidence_bundle.firstReplaySlot++;
	h = harness({ existing: changed });
	await assert.rejects(h.store.record(h.f), /conflicting immutable/);
	assert.equal(h.calls.at(-1).sql, "ROLLBACK");
	assert.ok(h.released[0] instanceof Error);
});
test("wrong environment fails before insert; invalid input fails before connection", async () => {
	const h = harness({ identity: { manifest_sha256: "b".repeat(64) } });
	await assert.rejects(h.store.record(h.f), /identity pins/);
	assert.equal(
		h.calls.some((c) => c.sql.startsWith("INSERT")),
		false,
	);
	const other = harness();
	other.f.anchorSlot++;
	await assert.rejects(other.store.record(other.f), /anchor slot/);
	assert.equal(other.calls.length, 0);
});
for (const failOn of ["BEGIN", "INSERT", "COMMIT"])
	test(`store discards on ${failOn} failure`, async () => {
		const h = harness({ failOn, failRollback: true });
		await assert.rejects(h.store.record(h.f), /driver failure/);
		assert.ok(h.released[0] instanceof Error);
	});
