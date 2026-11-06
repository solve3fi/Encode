import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { createUserPaidPassService } from "./pass-user-paid-mint.mjs";
import { createDurablePassportAuth } from "./passport-durable-auth.mjs";
import { createPublicPassportAuth } from "./passport-public-enrollment.mjs";

export async function rehearsePublicPassport({
	connection,
	makePool,
	authRole,
	capabilityRole,
}) {
	const database = (await connection.query("SELECT current_database() AS db"))
		.rows[0].db;
	assert.match(database, /^quest_q5_it_/);
	for (const name of [
		"015_user_paid_pass.sql",
		"016_public_passport_enrollment.sql",
	])
		await connection.query(
			await readFile(
				new URL(`../../db/quest/migrations/${name}`, import.meta.url),
				"utf8",
			),
		);
	await connection.query(
		`GRANT EXECUTE ON FUNCTION quest.take_passport_rate_limit(text,text),quest.issue_passport_enrollment(text,text,uuid,text,uuid,text),quest.complete_passport_enrollment(text,text,uuid,text,timestamptz,timestamptz,uuid,text,text) TO "${capabilityRole}"`,
	);
	await connection.query(
		`GRANT SELECT,INSERT ON quest.pass_mint_reservations TO "${authRole}"`,
	);
	await connection.query(
		`GRANT UPDATE(verified_at,prepared) ON quest.pass_mint_reservations TO "${authRole}"`,
	);
	const basePool = makePool(capabilityRole);
	const enrollmentPool = {
		...basePool,
		query: async (...args) => {
			const c = await basePool.connect();
			try {
				return await c.query(...args);
			} finally {
				c.release();
			}
		},
	};
	const environment = {
		network: "DEVNET",
		environmentId: "33333333-3333-4333-8333-333333333333",
		manifestSha256: "a".repeat(64),
	};
	const origin = "https://quest.solve3.test",
		context = { origin, clientKey: "public-enrollment-fixture" },
		rateKeySecret = Buffer.alloc(32, 43);
	const auth = createPublicPassportAuth({
		auth: createDurablePassportAuth({
			pool: makePool(authRole),
			environment,
			origin,
			rateKeySecret,
			recoverableCsrf: true,
			ratePolicies: Object.fromEntries(
				["challenge", "authenticate", "session"].map((scope) => [
					scope,
					{ limit: 1000, windowMs: 3600000 },
				]),
			),
		}),
		enrollmentPool,
		environment,
		rateKeySecret,
	});
	const pair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(199)),
		wallet = new PublicKey(pair.publicKey).toBase58();
	const challenge = await auth.issueWalletChallenge({ wallet }, context);
	assert.equal(challenge.enrollment, true);
	assert.equal(
		(
			await connection.query(
				"SELECT count(*)::int AS n FROM quest.wallet_bindings WHERE wallet=$1",
				[wallet],
			)
		).rows[0].n,
		0,
	);
	await assert.rejects(
		auth.enroll(
			{
				message: challenge.message,
				signature: Buffer.alloc(64).toString("base64"),
			},
			context,
		),
	);
	assert.equal(
		(
			await connection.query(
				"SELECT count(*)::int AS n FROM quest.wallet_bindings WHERE wallet=$1",
				[wallet],
			)
		).rows[0].n,
		0,
	);
	const signature = Buffer.from(
		nacl.sign.detached(
			new TextEncoder().encode(challenge.message),
			pair.secretKey,
		),
	).toString("base64");
	await assert.rejects(
		auth.enroll(
			{ message: challenge.message, signature },
			{ ...context, clientKey: "bad\nkey" },
		),
	);
	assert.equal(
		(
			await connection.query(
				"SELECT count(*)::int AS n FROM quest.wallet_bindings WHERE wallet=$1",
				[wallet],
			)
		).rows[0].n,
		0,
	);
	const results = await Promise.allSettled([
		auth.enroll({ message: challenge.message, signature }, context),
		auth.enroll({ message: challenge.message, signature }, context),
	]);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	const session = results.find((r) => r.status === "fulfilled").value;
	const cookieHeader = session.cookie.split(";")[0];
	assert.equal(
		(await auth.resume({ cookieHeader }, context)).csrfToken,
		session.csrfToken,
	);
	const links = await connection.query(
		"SELECT l.linked_at,e.consumed_at FROM quest.wallet_links l JOIN quest.passport_enrollment_proofs e ON e.wallet=l.wallet AND e.passport_id=l.passport_id WHERE l.wallet=$1",
		[wallet],
	);
	assert.equal(links.rows.length, 1);
	assert.equal(
		links.rows[0].linked_at.getTime(),
		links.rows[0].consumed_at.getTime(),
	);
	const existing = await auth.issueWalletChallenge({ wallet }, context);
	assert.notEqual(existing.enrollment, true);
	const rpc = {
		getGenesisHash: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
		getMultipleAccountsInfo: async () => [null, null],
		getAccountInfo: async () => null,
		getBlockHeight: async () => 1,
		getMinimumBalanceForRentExemption: async (n) => n * 1000,
		getLatestBlockhash: async () => ({
			blockhash: wallet,
			lastValidBlockHeight: 1000,
		}),
		getFeeForMessage: async () => ({ value: 10000 }),
	};
	const pass = createUserPaidPassService({
		auth,
		connection: rpc,
		seed: new Uint8Array(32).fill(3),
		origin,
	});
	const authentication = { cookieHeader, csrfToken: session.csrfToken };
	const prepared = await Promise.all([
		pass.prepare(authentication, context),
		pass.prepare(authentication, context),
	]);
	assert.equal(prepared[0].transaction, prepared[1].transaction);
	const statuses = await Promise.all([
		pass.status(authentication, context),
		pass.status(authentication, context),
	]);
	assert.equal(statuses[0].mint, statuses[1].mint);
	assert.equal(statuses[0].status, "NOT_MINTED");
	await assert.rejects(
		pass.status(
			{ ...authentication, csrfToken: Buffer.alloc(32).toString("base64url") },
			context,
		),
	);
	assert.equal(
		(
			await connection.query(
				"SELECT count(*)::int AS n FROM quest.pass_mint_reservations WHERE wallet=$1",
				[wallet],
			)
		).rows[0].n,
		1,
	);
	await assert.rejects(
		connection.query(
			"DELETE FROM quest.pass_mint_reservations WHERE wallet=$1",
			[wallet],
		),
	);
	await assert.rejects(
		connection.query("TRUNCATE quest.pass_mint_reservations"),
	);
	const restricted = await makePool(authRole).connect();
	try {
		await assert.rejects(
			restricted.query(
				"INSERT INTO quest.passports(network,passport_id) VALUES('DEVNET',gen_random_uuid())",
			),
			(e) => e.code === "42501",
		);
	} finally {
		restricted.release();
	}
	await auth.logout(authentication, context);
	await assert.rejects(auth.resume({ cookieHeader }, context));
	assert.equal(
		(await connection.query("SELECT count(*)::int AS n FROM quest.xp_events"))
			.rows[0].n,
		0,
	);
	console.log(
		"Public Passport SQL: real signed enrollment, race/replay refusal, no pre-sign identity or backdated links, recoverable session/CSRF, narrow serving privilege, one mint reservation, wrong CSRF/logout/immutability refusals, zero XP passed.",
	);
}
