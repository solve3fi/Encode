import assert from "node:assert/strict";
import { test } from "node:test";
import {
	activePassportForWallet,
	isWalletLinkedToPassport,
} from "./wallet-link-lookup.mjs";

const wallet = "1".repeat(32);
const passportId = "11111111-1111-4111-8111-111111111111";

test("uses a parameterized Devnet active-link query", async () => {
	const calls = [];
	const connection = {
		async query(sql, values) {
			calls.push({ sql, values });
			return { rows: [{ passport_id: passportId }] };
		},
	};
	assert.equal(await activePassportForWallet(connection, wallet), passportId);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].values, [wallet]);
	assert.match(calls[0].sql, /network = 'DEVNET'/);
	assert.match(calls[0].sql, /unlinked_at IS NULL/);
	assert.match(calls[0].sql, /linked_at <= now\(\)/);
	assert.ok(!calls[0].sql.includes(wallet));
});

test("returns null for no active link and false for a different Passport", async () => {
	assert.equal(await activePassportForWallet({ query: async () => ({ rows: [] }) }, wallet), null);
	assert.equal(
		await isWalletLinkedToPassport(
			{ query: async () => ({ rows: [{ passport_id: passportId }] }) },
			"22222222-2222-4222-8222-222222222222",
			wallet,
		),
		false,
	);
});

test("fails closed on malformed inputs, duplicate rows and database errors", async () => {
	let queried = false;
	const connection = {
		async query() {
			queried = true;
			return { rows: [] };
		},
	};
	await assert.rejects(activePassportForWallet(connection, "not-a-wallet"), /invalid Devnet wallet/);
	assert.equal(queried, false);
	await assert.rejects(activePassportForWallet(null, wallet), /query connection/);
	await assert.rejects(
		activePassportForWallet({ query: async () => ({ rows: [{ passport_id: passportId }, { passport_id: passportId }] }) }, wallet),
		/invalid active ownership/,
	);
	await assert.rejects(
		activePassportForWallet({ query: async () => ({ rows: [{ passport_id: "bad" }] }) }, wallet),
		/canonical lowercase UUID/,
	);
	await assert.rejects(
		activePassportForWallet({ query: async () => { throw new Error("database unavailable"); } }, wallet),
		/database unavailable/,
	);
});
