import assert from "node:assert/strict";
import { test } from "node:test";
import {
	QUEST_IDENTITY_SQL,
	readQuestDatabaseIdentity,
} from "./database-identity.mjs";

function validRow() {
	return {
		databaseName: "quest_devnet",
		sessionUser: "quest_runtime",
		currentUser: "quest_runtime",
		superuser: false,
		canCreateQuestObjects: false,
		canCreatePublicObjects: false,
		canCreateDatabaseObjects: false,
		canMutateIdentity: false,
		identity: {
			network: "DEVNET",
			genesisHash: "a".repeat(64),
			environmentId: "00000000-0000-0000-0000-000000000000",
			manifestSha256: "b".repeat(64),
			namespace: "quest",
		},
	};
}

function fakeConnection(rows) {
	return {
		queries: [],
		async query(sql) {
			this.queries.push(sql);
			return { rows };
		},
	};
}

test("QUEST_IDENTITY_SQL is the environment identity statement", () => {
	assert.equal(typeof QUEST_IDENTITY_SQL, "string");
	assert.match(QUEST_IDENTITY_SQL, /current_database\(\)/);
	assert.match(QUEST_IDENTITY_SQL, /environment_identity/);
});

test("fully valid row returns the normalized nine-key object", async () => {
	const connection = fakeConnection([validRow()]);
	const result = await readQuestDatabaseIdentity(connection);
	assert.deepEqual(Object.keys(result).sort(), [
		"canCreateDatabaseObjects",
		"canCreatePublicObjects",
		"canCreateQuestObjects",
		"canMutateIdentity",
		"currentUser",
		"databaseName",
		"identity",
		"sessionUser",
		"superuser",
	]);
	assert.deepEqual(result, validRow());
	assert.equal(connection.queries[0], QUEST_IDENTITY_SQL);
});

test("identity null is still returned", async () => {
	const connection = fakeConnection([{ ...validRow(), identity: null }]);
	const result = await readQuestDatabaseIdentity(connection);
	assert.equal(result.identity, null);
	assert.equal(Object.keys(result).length, 9);
});

test("zero rows throws", async () => {
	await assert.rejects(
		() => readQuestDatabaseIdentity(fakeConnection([])),
		/Quest database identity requires exactly one row/,
	);
});

test("two rows throws", async () => {
	await assert.rejects(
		() => readQuestDatabaseIdentity(fakeConnection([validRow(), validRow()])),
		/Quest database identity requires exactly one row/,
	);
});

test("non-boolean privilege flag throws", async () => {
	await assert.rejects(
		() =>
			readQuestDatabaseIdentity(
				fakeConnection([{ ...validRow(), superuser: "false" }]),
			),
		/Quest database identity requires boolean privilege flags/,
	);
});

test("missing string column throws", async () => {
	const row = validRow();
	delete row.sessionUser;
	await assert.rejects(
		() => readQuestDatabaseIdentity(fakeConnection([row])),
		/Quest database identity requires non-empty strings/,
	);
});
