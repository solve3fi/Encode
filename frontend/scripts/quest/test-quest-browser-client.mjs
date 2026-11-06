import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChallengeMessage } from "./passport-challenge.mjs";
import {
	checkWalletChallenge,
	createQuestBrowserClient,
} from "./quest-browser-client.mjs";

const passportId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	wallet = "11111111111111111111111111111111",
	origin = "https://quest.solve3.test",
	campaignId = "browser-fixture";
const referralBody = () => ({
	campaignId,
	passportId,
	testOnly: true,
	code: "ABCDEFGH",
	ratePercent: 10,
	maxReferrals: 25,
	referredCount: 1,
	bonusXp: 25,
	referredBy: false,
});
function fixture(options = {}) {
	const calls = [],
		now = Date.now(),
		expiresAt = new Date(now + 120000).toISOString();
	const message = buildChallengeMessage({
		passportId,
		wallet,
		domain: new URL(origin).host,
		action: "passport.authenticate",
		nonce: Buffer.alloc(32, 1).toString("base64url"),
		issuedAt: new Date(now).toISOString(),
		expiresAt,
	});
	const snapshot = {
			passportId,
			campaignId,
			fixtureKind: "SYNTHETIC_DEVNET",
			awardEligible: false,
			weekly: null,
			communityGoals: [],
			milestones: [],
		},
		history = { ...snapshot, receipts: [], nextCursor: null };
	const client = createQuestBrowserClient({
		origin,
		campaignId,
		fetchImpl: async (url, request) => {
			calls.push({ url, request });
			if (url.endsWith("resume"))
				return options.resume
					? Response.json(options.resume)
					: Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
			await options.wait?.(url);
			if (options.failure)
				return Response.json({ error: options.failure }, { status: 503 });
			return Response.json(
				url.endsWith("wallet-challenge")
					? {
							network: "DEVNET",
							enrollment: options.enrollment === true,
							message: options.message ?? message,
							expiresAt,
						}
					: url.endsWith("authenticate") || url.endsWith("enroll")
						? {
								wallet,
								passportId,
								network: "DEVNET",
								csrfToken: Buffer.alloc(32, 2).toString("base64url"),
								expiresAt,
							}
						: url.endsWith("snapshot")
							? (options.snapshot ?? snapshot)
							: url.endsWith("history")
								? history
								: url.endsWith("pass/status")
									? options.passStatus
									: url.endsWith("social-claim")
									? (options.socialClaim ?? { campaignId, passportId, testOnly: true, result: "OK", social: socialBody() })
									: url.endsWith("partner-lead")
									? (options.lead ?? { campaignId, passportId, testOnly: true, result: "OK", partnerScout: scoutBody() })
									: url.endsWith("redeem-referral")
									? (options.redeem ?? { ...referralBody(), result: "OK" })
									: url.endsWith("calendar/referral")
									? (options.referral ?? referralBody())
									: url.endsWith("xp")
									? ((typeof options.xp === "function" ? options.xp() : options.xp) ?? {
											campaignId,
											passportId,
											testOnly: true,
											totalXp: 100,
											onboarding: [
												{
													id: "connect-wallet",
													title: "Connect your wallet",
													description: "Sign in once.",
													xp: 100,
													completed: true,
													awardedAt: "2026-10-04T12:00:00.000Z",
												},
											],
										})
									: {},
			);
		},
	});
	return { client, calls, message, expiresAt, snapshot };
}
test("browser verifies canonical wallet/domain challenge and signs only Devnet message", async () => {
	const f = fixture();
	f.client.setIdentity(wallet, "devnet");
	let signed;
	await f.client.signIn(async (bytes) => {
		signed = new TextDecoder().decode(bytes);
		return new Uint8Array(64);
	});
	assert.equal(signed, f.message);
	assert.equal(f.client.getState().status, "READY");
	assert.equal(f.calls.length, 5);
	assert.ok(
		f.calls.every(
			(c) =>
				c.request.credentials === "same-origin" &&
				c.request.cache === "no-store",
		),
	);
	assert.ok(f.calls.at(-1).request.headers["X-Solve3-CSRF"]);
	assert.ok(!JSON.stringify(f.client.getState()).includes("csrfToken"));
	await f.client.logout();
	assert.equal(f.client.getState().history, null);
	assert.equal(f.client.getState().status, "SIGNED_OUT");
});
for (const [network, status] of [
	["mainnet-beta", "WRONG_NETWORK"],
	["testnet", "WRONG_NETWORK"],
	["devnet", "SIGNED_OUT"],
])
	test(`browser identity ${network}`, async () => {
		const f = fixture();
		f.client.setIdentity(wallet, network);
		assert.equal(f.client.getState().status, status);
		if (network !== "devnet") {
			await f.client.signIn(() => assert.fail());
			assert.equal(f.calls.length, 0);
		}
	});
test("disconnect clears every personal view and aborts in-flight wallet signature", async () => {
	const f = fixture();
	f.client.setIdentity(wallet, "devnet");
	let resolve, signing;
	const started = new Promise((r) => (signing = r));
	const pending = f.client.signIn(() => {
		signing();
		return new Promise((r) => (resolve = r));
	});
	await started;
	f.client.setIdentity(null, "devnet");
	resolve(new Uint8Array(64));
	await pending;
	assert.equal(f.client.getState().status, "DISCONNECTED");
	assert.equal(f.calls.length, 1);
	assert.equal(f.client.getState().snapshot, null);
});
test("wallet switch discards an old snapshot even if fetch ignores abort", async () => {
	let release, reached;
	const blocked = new Promise((r) => (reached = r));
	const f = fixture({
		wait: async (url) => {
			if (url.endsWith("snapshot")) {
				reached();
				await new Promise((r) => (release = r));
			}
		},
	});
	f.client.setIdentity(wallet, "devnet");
	const pending = f.client.signIn(async () => new Uint8Array(64));
	await blocked;
	f.client.setIdentity("different-wallet", "devnet");
	release();
	await pending;
	assert.equal(f.client.getState().status, "SIGNED_OUT");
	assert.equal(f.client.getState().snapshot, null);
});
test("wrong Passport response refuses rendering private data", async () => {
	const f = fixture({ snapshot: { passportId: "wrong" } });
	f.client.setIdentity(wallet, "devnet");
	await f.client.signIn(async () => new Uint8Array(64));
	assert.equal(f.client.getState().status, "ERROR");
	assert.equal(f.client.getState().snapshot, null);
});
for (const code of [
	"UNAUTHORIZED",
	"FORBIDDEN",
	"RATE_LIMITED",
	"SQL private diagnostic",
])
	test(`browser sanitized ${code}`, async () => {
		const f = fixture({ failure: code });
		f.client.setIdentity(wallet, "devnet");
		await f.client.signIn(async () => new Uint8Array(64));
		assert.equal(
			f.client.getState().error,
			code.includes("private") ? "UNAVAILABLE" : code,
		);
	});
test("browser rejects wrong challenge domain/wallet/action/network before signing", async () => {
	for (const [from, to] of [
		["domain: quest.solve3.test", "domain: evil.test"],
		[`wallet: ${wallet}`, "wallet: wrong"],
		["network: DEVNET", "network: MAINNET"],
		["action: passport.authenticate", "action: transfer"],
	]) {
		const base = fixture();
		const f = fixture({ message: base.message.replace(from, to) });
		f.client.setIdentity(wallet, "devnet");
		await f.client.signIn(() => assert.fail("must not sign"));
		assert.equal(f.client.getState().status, "ERROR");
	}
});
test("expired and extra-line challenges refuse", () => {
	const f = fixture();
	assert.throws(() =>
		checkWalletChallenge(
			{
				network: "DEVNET",
				message: `${f.message}\nextra`,
				expiresAt: f.expiresAt,
			},
			{ wallet, origin },
		),
	);
	assert.throws(() =>
		checkWalletChallenge(
			{ network: "DEVNET", message: f.message, expiresAt: f.expiresAt },
			{ wallet, origin, nowMs: Date.now() + 300000 },
		),
	);
});

test("connect checks existing cookie session before signature and enrolls unknown signed wallet", async () => {
	const f = fixture({ enrollment: true });
	f.client.setIdentity(wallet, "devnet");
	let signed = 0;
	await f.client.connect(async () => {
		signed++;
		return new Uint8Array(64);
	});
	assert.equal(signed, 1);
	assert.equal(f.client.getState().status, "READY");
	assert.ok(f.calls[0].url.endsWith("resume"));
	assert.ok(f.calls.some((c) => c.url.endsWith("enroll")));
});
test("valid recovered session loads private data with no wallet prompt", async () => {
	const resume = {
		network: "DEVNET",
		wallet,
		passportId,
		csrfToken: Buffer.alloc(32, 2).toString("base64url"),
		expiresAt: new Date(Date.now() + 60000).toISOString(),
	};
	const f = fixture({ resume });
	f.client.setIdentity(wallet, "devnet");
	await f.client.connect(() => assert.fail("must not ask for signature"));
	assert.equal(f.client.getState().status, "READY");
	assert.equal(f.calls.length, 4);
});
test("another wallet cookie requires a fresh connected-wallet signature before loading", async () => {
	const resume = {
		network: "DEVNET",
		wallet: "22222222222222222222222222222222",
		passportId,
		csrfToken: Buffer.alloc(32, 2).toString("base64url"),
		expiresAt: new Date(Date.now() + 60000).toISOString(),
	};
	const f = fixture({ resume });
	f.client.setIdentity(wallet, "devnet");
	let signed = 0;
	await f.client.connect(async () => {
		signed++;
		return new Uint8Array(64);
	});
	assert.equal(signed, 1);
	assert.equal(f.client.getState().status, "READY");
	assert.equal(f.calls.length, 6);
	assert.ok(f.calls[1].url.endsWith("wallet-challenge"));
});

test("test XP loads with the private view and is cleared on disconnect", async () => {
	const f = fixture({
		resume: {
			network: "DEVNET",
			wallet,
			passportId,
			csrfToken: Buffer.alloc(32, 2).toString("base64url"),
			expiresAt: new Date(Date.now() + 60000).toISOString(),
		},
	});
	f.client.setIdentity(wallet, "devnet");
	await f.client.connect(() => assert.fail("must not ask for signature"));
	assert.equal(f.client.getState().xp.totalXp, 100);
	assert.equal(f.client.getState().xp.onboarding[0].completed, true);
	f.client.setIdentity(null, null);
	assert.equal(f.client.getState().xp, null);
});
test("malformed or foreign XP leaves the panel ready with XP unavailable", async () => {
	for (const xp of [
		{ testOnly: false },
		{ campaignId, passportId: "someone-else", testOnly: true, totalXp: 5, onboarding: [] },
		{ campaignId, passportId, testOnly: true, totalXp: -1, onboarding: [] },
		{ campaignId, passportId, testOnly: true, totalXp: 5, onboarding: [{ id: 1 }] },
	]) {
		const f = fixture({
			xp,
			resume: {
				network: "DEVNET",
				wallet,
				passportId,
				csrfToken: Buffer.alloc(32, 2).toString("base64url"),
				expiresAt: new Date(Date.now() + 60000).toISOString(),
			},
		});
		f.client.setIdentity(wallet, "devnet");
		await f.client.connect(() => assert.fail("must not ask for signature"));
		assert.equal(f.client.getState().status, "READY");
		assert.equal(f.client.getState().xp, null);
	}
});

test("a verified Pass mint reloads XP without a manual refresh", async () => {
	let minted = false;
	const award = (xp, completed) => ({
		campaignId,
		passportId,
		testOnly: true,
		totalXp: xp,
		onboarding: [
			{ id: "mint-pass", title: "Mint", description: "Mint it.", xp: 250, completed, awardedAt: completed ? "2026-10-04T12:00:00.000Z" : null },
		],
	});
	const f = fixture({
		xp: () => award(minted ? 350 : 100, minted),
		passStatus: { network: "DEVNET", awardEligible: false, wallet, mint: "M".repeat(40), status: "MINTED" },
		resume: {
			network: "DEVNET",
			wallet,
			passportId,
			csrfToken: Buffer.alloc(32, 2).toString("base64url"),
			expiresAt: new Date(Date.now() + 60000).toISOString(),
		},
	});
	f.client.setIdentity(wallet, "devnet");
	await f.client.connect(() => assert.fail("must not ask for signature"));
	assert.equal(f.client.getState().xp.totalXp, 100);
	minted = true;
	await f.client.pass("status");
	assert.equal(f.client.getState().xp.totalXp, 350);
	assert.equal(f.client.getState().xp.onboarding[0].completed, true);
});

const scoutBody = () => ({
	bountyXp: 5000,
	weeklyLimit: 3,
	remainingThisWeek: 2,
	leads: [{ name: "Acme", url: "https://acme.example", status: "SUBMITTED", submittedAt: "2026-10-06T00:00:00Z", note: null }],
});
const socialBody = (claimed = []) =>
	["follow-x", "post-x", "join-discord"].map((key) => ({
		key,
		title: key,
		description: "Do it once.",
		xp: 100,
		actionLabel: "Open",
		actionUrl: "https://x.com/solve3fi",
		postText: key === "post-x" ? "hello" : null,
		claimedAt: claimed.includes(key) ? "2026-10-07T00:00:00Z" : null,
	}));
async function signedIn(options) {
	const f = fixture(options);
	f.client.setIdentity(wallet, "devnet");
	await f.client.signIn(async () => new Uint8Array(64));
	return f;
}
test("referral overview and redemption go through the signed session and validate the shape", async () => {
	const f = await signedIn();
	const overview = await f.client.referral();
	assert.equal(overview.code, "ABCDEFGH");
	const redeemed = await f.client.redeemReferral("ABCD2345");
	assert.equal(redeemed.result, "OK");
	const sent = f.calls.filter((c) => String(c.url ?? c[0]).includes("referral"));
	assert.ok(sent.length >= 2);
});
test("referral calls refuse bad input and malformed server answers", async () => {
	const f = await signedIn();
	for (const code of ["short", "ABCDEFG!", 12345678, null])
		await assert.rejects(f.client.redeemReferral(code));
	const wrongPassport = await signedIn({ referral: { ...referralBody(), passportId: "22222222-2222-4222-8222-222222222222" } });
	await assert.rejects(wrongPassport.client.referral());
	const badCode = await signedIn({ referral: { ...referralBody(), code: "abc" } });
	await assert.rejects(badCode.client.referral());
	const badResult = await signedIn({ redeem: { ...referralBody(), result: "MAYBE" } });
	await assert.rejects(badResult.client.redeemReferral("ABCD2345"));
	const signedOut = fixture();
	await assert.rejects(signedOut.client.referral());
});

test("Voting XP is passed through when well formed, and dropped alone when malformed", async () => {
	const base = {
		campaignId,
		passportId,
		testOnly: true,
		totalXp: 100,
		onboarding: [],
	};
	const good = { testOnly: true, votingXp: 1500, xpPerEpoch: 500, currentEpoch: 9, votedThisEpoch: true, recentEpochs: [{ epoch: 8, earned: true }] };
	const cases = [
		[good, { ...good }],
		[{ ...good, currentEpoch: null }, { ...good, currentEpoch: null }],
		[undefined, null],
		[{ ...good, testOnly: false }, null],
		[{ ...good, votingXp: -1 }, null],
		[{ ...good, votingXp: 1.5 }, null],
		[{ ...good, xpPerEpoch: 0 }, null],
		[{ ...good, xpPerEpoch: undefined }, null],
		[{ ...good, votedThisEpoch: "yes" }, null],
		[{ ...good, recentEpochs: Array.from({ length: 9 }, (_, i) => ({ epoch: i, earned: true })) }, null],
		[{ ...good, recentEpochs: [{ epoch: 1, earned: false }] }, null],
	];
	for (const [voting, expected] of cases) {
		const f = fixture({
			xp: { ...base, voting },
			resume: {
				network: "DEVNET",
				wallet,
				passportId,
				csrfToken: Buffer.alloc(32, 2).toString("base64url"),
				expiresAt: new Date(Date.now() + 60000).toISOString(),
			},
		});
		f.client.setIdentity(wallet, "devnet");
		await f.client.connect(() => assert.fail("must not ask for signature"));
		const xp = f.client.getState().xp;
		assert.equal(xp.totalXp, 100, "Quest XP survives a bad voting section");
		assert.deepEqual(xp.voting, expected);
	}
});

test("a partner lead goes through the signed session with trimmed fields and returns the verdict and overview", async () => {
	const f = await signedIn();
	const out = await f.client.partnerLead({ name: " Acme ", url: " https://acme.example ", note: " hi " });
	assert.equal(out.result, "OK");
	assert.equal(out.partnerScout.remainingThisWeek, 2);
	const sent = f.calls.find((c) => String(c.url).endsWith("partner-lead"));
	assert.deepEqual(JSON.parse(sent.request.body), { campaignId, name: "Acme", url: "https://acme.example", note: "hi" });
	const dup = await signedIn({ lead: { campaignId, passportId, testOnly: true, result: "DUPLICATE", partnerScout: scoutBody() } });
	assert.equal((await dup.client.partnerLead({ name: "Acme", url: "https://acme.example", note: "" })).result, "DUPLICATE");
});

test("a partner lead refuses bad input and malformed answers", async () => {
	const f = await signedIn();
	for (const bad of [
		{ name: "A", url: "https://acme.example", note: "" },
		{ name: "Acme", url: "ftp://acme.example", note: "" },
		{ name: "Acme", url: "https://acme.example", note: "n".repeat(301) },
		{ name: "Acme", url: "https://acme.example", note: null },
	])
		await assert.rejects(f.client.partnerLead(bad));
	const wrongPassport = await signedIn({ lead: { campaignId, passportId: "22222222-2222-4222-8222-222222222222", testOnly: true, result: "OK", partnerScout: scoutBody() } });
	await assert.rejects(wrongPassport.client.partnerLead({ name: "Acme", url: "https://acme.example", note: "" }));
	const badResult = await signedIn({ lead: { campaignId, passportId, testOnly: true, result: "MAYBE", partnerScout: scoutBody() } });
	await assert.rejects(badResult.client.partnerLead({ name: "Acme", url: "https://acme.example", note: "" }));
	const badScout = await signedIn({ lead: { campaignId, passportId, testOnly: true, result: "OK", partnerScout: { bountyXp: 0 } } });
	await assert.rejects(badScout.client.partnerLead({ name: "Acme", url: "https://acme.example", note: "" }));
	await assert.rejects(fixture().client.partnerLead({ name: "Acme", url: "https://acme.example", note: "" }));
});

test("the Partner Scout section of the XP read is passed through when well formed and dropped alone when malformed", async () => {
	const base = { campaignId, passportId, testOnly: true, totalXp: 100, onboarding: [] };
	const good = await signedIn({ xp: { ...base, partnerScout: scoutBody() } });
	assert.equal(good.client.getState().xp.partnerScout.bountyXp, 5000);
	const bad = await signedIn({ xp: { ...base, partnerScout: { bountyXp: "lots" } } });
	assert.equal(bad.client.getState().xp.partnerScout, null);
	assert.equal(bad.client.getState().xp.totalXp, 100);
});

test("a social quest claim goes through the signed session and returns the updated list", async () => {
	const f = await signedIn({ socialClaim: { campaignId, passportId, testOnly: true, result: "OK", social: socialBody(["follow-x"]) } });
	const out = await f.client.socialClaim("follow-x");
	assert.equal(out.result, "OK");
	assert.equal(out.social.find((q) => q.key === "follow-x").claimedAt !== null, true);
	const sent = f.calls.find((c) => String(c.url).endsWith("social-claim"));
	assert.deepEqual(JSON.parse(sent.request.body), { campaignId, quest: "follow-x" });
});

test("a social quest claim refuses unknown quests and malformed answers", async () => {
	const f = await signedIn();
	await assert.rejects(f.client.socialClaim("follow-everyone"));
	const wrongPassport = await signedIn({ socialClaim: { campaignId, passportId: "22222222-2222-4222-8222-222222222222", testOnly: true, result: "OK", social: socialBody() } });
	await assert.rejects(wrongPassport.client.socialClaim("follow-x"));
	const badResult = await signedIn({ socialClaim: { campaignId, passportId, testOnly: true, result: "MAYBE", social: socialBody() } });
	await assert.rejects(badResult.client.socialClaim("follow-x"));
	const unsafeLink = await signedIn({ socialClaim: { campaignId, passportId, testOnly: true, result: "OK", social: [{ ...socialBody()[0], actionUrl: "javascript:alert(1)" }] } });
	await assert.rejects(unsafeLink.client.socialClaim("follow-x"));
	await assert.rejects(fixture().client.socialClaim("follow-x"));
});

test("the social section of the XP read is passed through when well formed and dropped alone when malformed", async () => {
	const base = { campaignId, passportId, testOnly: true, totalXp: 100, onboarding: [] };
	const good = await signedIn({ xp: { ...base, social: socialBody() } });
	assert.equal(good.client.getState().xp.social.length, 3);
	const bad = await signedIn({ xp: { ...base, social: [{ key: "follow-x", xp: "lots" }] } });
	assert.equal(bad.client.getState().xp.social, null);
	assert.equal(bad.client.getState().xp.totalXp, 100);
});
