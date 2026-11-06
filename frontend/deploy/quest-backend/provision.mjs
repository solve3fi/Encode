// Provision the Devnet TEST identities and publish the synthetic calendar. Operator-only tool:
// it is never reachable over HTTP. Wallet sign-in does NOT create a Passport, so each tester
// wallet is linked to an existing Passport here, by a database operator.
//
//   QUEST_OWNER_DB_URL   owner role (inserts Passports, links, rate policies, the operator grant)
//   QUEST_OPERATOR_DB_URL operator login role (signs in as the throwaway operator and publishes)
//   QUEST_ENVIRONMENT_ID, QUEST_MANIFEST_SHA256, QUEST_RATE_KEY_SECRET, QUEST_WEB_ORIGIN
//   QUEST_CAMPAIGN_ID    e.g. solve3-devnet-test-2026
//   QUEST_TEST_WALLETS   comma-separated public Devnet wallet addresses to provision
//
// The operator keypair is generated in memory, used once to publish, and discarded. Its grant
// expires after two hours. No private key is written anywhere or printed.
import { randomUUID, createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import pg from "pg";
import { createDurablePassportAuth } from "../scripts/quest/passport-durable-auth.mjs";
import { createQuestCalendarExample } from "../scripts/quest/quest-calendar-example.mjs";
import { createQuestCalendarService } from "../scripts/quest/quest-calendar-service.mjs";

const need = (name) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required setting ${name}`);
	return value;
};
const webOrigin = need("QUEST_WEB_ORIGIN");
const campaignId = need("QUEST_CAMPAIGN_ID");
const environment = {
	network: "DEVNET",
	environmentId: need("QUEST_ENVIRONMENT_ID"),
	manifestSha256: need("QUEST_MANIFEST_SHA256"),
};
const wallets = need("QUEST_TEST_WALLETS")
	.split(",")
	.map((w) => w.trim())
	.filter(Boolean)
	.map((w) => new PublicKey(w).toBase58());
const window = 3_600_000;
const ratePolicies = {
	challenge: { limit: 600, windowMs: window },
	authenticate: { limit: 600, windowMs: window },
	session: { limit: 6000, windowMs: window },
};
const context = { origin: webOrigin, clientKey: "operator-provisioning" };

const owner = new pg.Client({ connectionString: need("QUEST_OWNER_DB_URL") });
await owner.connect();
const operatorPool = new pg.Pool({ connectionString: need("QUEST_OPERATOR_DB_URL"), max: 3 });

const linkEvidence = (wallet, kind) =>
	createHash("sha256")
		.update(`solve3 devnet test link:${kind}:${wallet}`)
		.digest("hex");

async function provisionWallet(wallet, kind) {
	const existing = await owner.query(
		"SELECT passport_id FROM quest.wallet_bindings WHERE network='DEVNET' AND wallet=$1",
		[wallet],
	);
	let passportId = existing.rows[0]?.passport_id;
	if (!passportId) {
		passportId = randomUUID();
		await owner.query("INSERT INTO quest.passports(network,passport_id) VALUES('DEVNET',$1)", [passportId]);
		await owner.query(
			"INSERT INTO quest.wallet_bindings(network,wallet,passport_id) VALUES('DEVNET',$1,$2)",
			[wallet, passportId],
		);
	}
	let link = (
		await owner.query(
			"SELECT link_id FROM quest.wallet_links WHERE wallet=$1 AND passport_id=$2 AND unlinked_at IS NULL",
			[wallet, passportId],
		)
	).rows[0]?.link_id;
	if (!link)
		link = (
			await owner.query(
				"INSERT INTO quest.wallet_links(wallet,passport_id,linked_at,link_evidence_sha256) VALUES($1,$2,clock_timestamp()-interval '10 minutes',$3) RETURNING link_id",
				[wallet, passportId, linkEvidence(wallet, kind)],
			)
		).rows[0].link_id;
	return { wallet, passportId, link };
}

try {
	// Rate policies are immutable rows; write them once.
	for (const [scope, p] of Object.entries(ratePolicies))
		await owner.query(
			"INSERT INTO quest.passport_rate_policies(scope,request_limit,window_ms) VALUES($1,$2,$3) ON CONFLICT (scope) DO NOTHING",
			[scope, p.limit, p.windowMs],
		);

	const testers = [];
	for (const wallet of wallets) testers.push(await provisionWallet(wallet, "tester"));

	// Throwaway operator identity for the one-off publish.
	const pair = nacl.sign.keyPair();
	const operatorWallet = new PublicKey(pair.publicKey).toBase58();
	const op = await provisionWallet(operatorWallet, "operator");
	const issued = new Date(
		(await owner.query("SELECT date_trunc('milliseconds', clock_timestamp()) AS now")).rows[0].now,
	);
	await owner.query(
		"INSERT INTO quest.calendar_operator_grants(grant_id,passport_id,link_id,campaign_id,capability,issued_at,expires_at) VALUES($1,$2,$3,$4,'publish',$5,$6)",
		[randomUUID(), op.passportId, op.link, campaignId, issued, new Date(issued.getTime() + 2 * 3_600_000)],
	);

	const auth = createDurablePassportAuth({
		pool: operatorPool,
		environment,
		origin: webOrigin,
		ratePolicies,
		rateKeySecret: Buffer.from(need("QUEST_RATE_KEY_SECRET"), "base64"),
	});
	const service = createQuestCalendarService({ auth, environment });
	const challenge = await auth.issueWalletChallenge({ wallet: operatorWallet }, context);
	const session = await auth.authenticate(
		{
			message: challenge.message,
			signature: Buffer.from(
				nacl.sign.detached(new TextEncoder().encode(challenge.message), pair.secretKey),
			).toString("base64"),
		},
		context,
	);
	const credentials = { cookieHeader: session.cookie.split(";")[0], csrfToken: session.csrfToken };

	const existingPlan = (
		await owner.query("SELECT count(*)::int AS n FROM quest.calendar_plans WHERE campaign_id=$1", [campaignId])
	).rows[0].n;
	if (existingPlan > 0) {
		console.log(`calendar ${campaignId} already published; leaving it unchanged`);
	} else {
		const plan = createQuestCalendarExample(new Date().getUTCFullYear());
		plan.campaignId = campaignId;
		const published = await service.mutate(
			"publish",
			{ requestId: randomUUID(), plan },
			credentials,
			context,
		);
		console.log(`published ${campaignId}: revision ${published.revision ?? "?"}, awardEligible ${published.awardEligible ?? false}`);
	}
	await auth.logout({ cookieHeader: credentials.cookieHeader, csrfToken: credentials.csrfToken }, context).catch(() => {});

	for (const t of testers)
		console.log(`provisioned tester wallet ${t.wallet} -> passport ${t.passportId} (link ${t.link})`);
	console.log("operator identity discarded; its publish grant expires within two hours");
} finally {
	await operatorPool.end().catch(() => {});
	await owner.end().catch(() => {});
}
