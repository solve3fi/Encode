// Explicit operator smoke test. Never logs keys, cookies, signatures or CSRF.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { checkWalletChallenge } from "./quest-browser-client.mjs";

const args = Object.fromEntries(
	process.argv.slice(2).map((s) => {
		const [key, ...value] = s.replace(/^--/, "").split("=");
		return [key, value.join("=") || "true"];
	}),
);
const origin = args.origin ?? "https://solve3.fi";
const transport = args.transport ?? origin;
if (
	origin !== "https://solve3.fi" ||
	(transport !== origin &&
		transport !== "http://127.0.0.1:3418" &&
		transport !== "http://127.0.0.1:18080")
)
	throw Error(
		"Use canonical HTTPS origin or the explicit localhost SSH stage tunnel",
	);
const path = args["wallet-file"];
if (
	!path?.startsWith("/tmp/") ||
	!statSync(path).isFile() ||
	(statSync(path).mode & 0o077) !== 0
)
	throw Error("Private operator wallet file under /tmp required");
let key;
try {
	key = Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
	);
} catch {
	throw Error("Invalid private wallet file");
}
const wallet = key.publicKey.toBase58();
let cookie = "",
	csrf = "";
async function post(scope, operation, body = {}, expected = 200) {
	const endpoint =
		transport === origin
			? `/api/quest-test/${scope}/${operation}`
			: `/${scope}/${operation}`;
	const response = await fetch(transport + endpoint, {
		method: "POST",
		headers: {
			Origin: origin,
			"Content-Type": "application/json",
			...(cookie ? { Cookie: cookie } : {}),
			...(csrf ? { "X-Solve3-CSRF": csrf } : {}),
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(20000),
	});
	assert.equal(response.status, expected, `${scope}/${operation} HTTP status`);
	if (expected !== 200) return null;
	const set = response.headers.getSetCookie();
	if (set.length) cookie = set[0].split(";")[0];
	return response.json();
}
try {
	const challenge = await post("passport", "wallet-challenge", { wallet });
	const passportId = checkWalletChallenge(challenge, { wallet, origin });
	const signature = Buffer.from(
		nacl.sign.detached(
			new TextEncoder().encode(challenge.message),
			key.secretKey,
		),
	).toString("base64");
	const session = await post(
		"passport",
		challenge.enrollment ? "enroll" : "authenticate",
		{ message: challenge.message, signature },
	);
	assert.equal(session.passportId, passportId);
	assert.equal(session.wallet, wallet);
	assert(cookie);
	csrf = session.csrfToken;
	const resumed = await post("passport", "resume");
	assert.equal(resumed.csrfToken, csrf);
	assert.equal(resumed.wallet, wallet);
	const snapshot = await post("calendar", "snapshot", {
		campaignId: "solve3-devnet-test-2026",
	});
	assert.equal(snapshot.passportId, passportId);
	assert.equal(snapshot.awardEligible, false);
	const plan = await post("pass", "prepare");
	assert.equal(plan.wallet, wallet);
	assert.equal(plan.network, "DEVNET");
	console.log(
		"Signed enrollment/session recovery/private snapshot passed. Wallet:",
		wallet,
	);
	if (plan.status === "PREPARED") {
		const repeated = await post("pass", "prepare");
		assert.equal(repeated.transaction, plan.transaction);
		console.log(
			"Cached user-paid mint prepared. Maximum lamports:",
			plan.maxCostLamports,
		);
		if (args.mint === "true") {
			const rpc = new Connection("https://api.devnet.solana.com", "confirmed");
			assert.equal(
				await rpc.getGenesisHash(),
				"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
			);
			assert(
				(await rpc.getBalance(key.publicKey)) >= plan.maxCostLamports,
				"Test wallet needs Devnet SOL",
			);
			const tx = Transaction.from(Buffer.from(plan.transaction, "base64"));
			assert(tx.feePayer.equals(key.publicKey));
			assert.equal(tx.recentBlockhash, plan.blockhash);
			tx.partialSign(key);
			const sent = await rpc.sendRawTransaction(tx.serialize(), {
				skipPreflight: false,
				maxRetries: 3,
			});
			const confirmation = await rpc.confirmTransaction(
				{
					signature: sent,
					blockhash: plan.blockhash,
					lastValidBlockHeight: plan.lastValidBlockHeight,
				},
				"finalized",
			);
			assert.equal(confirmation.value.err, null);
			const verified = await post("pass", "status");
			assert.equal(verified.status, "MINTED");
			console.log(
				"Finalized non-transferable user-paid Devnet Pass verified:",
				verified.mint,
			);
		}
	} else {
		assert.equal(plan.status, "MINTED");
		console.log("Existing finalized Pass verified:", plan.mint);
	}
	await post("passport", "logout");
	csrf = "";
	await post("passport", "resume", {}, 401);
	console.log("Logout invalidation passed. No live XP awarded.");
} catch (error) {
	console.error(
		"Smoke test failed:",
		error instanceof assert.AssertionError
			? error.message
			: "request or verification unavailable",
	);
	process.exitCode = 1;
}
