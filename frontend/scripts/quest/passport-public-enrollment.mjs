import { createHash, createHmac, randomUUID } from "node:crypto";
import {
	buildChallengeMessage,
	createNonce,
	hashNonce,
	parseChallengeMessage,
} from "./passport-challenge.mjs";
import { PassportAuthFault } from "./passport-durable-auth.mjs";
import { verifyPassportSignature } from "./passport-signature.mjs";

const fail = (code = "UNAVAILABLE") => {
	throw new PassportAuthFault(code);
};

// Separate narrow capability pool. The ordinary serving login receives no
// INSERT authority over Passports, bindings, links or enrollment proofs.
export function createPublicPassportAuth({
	auth,
	enrollmentPool,
	environment,
	rateKeySecret,
}) {
	const domain = new URL(auth.origin).host;
	async function rate(wallet) {
		const c = await enrollmentPool.connect();
		try {
			await c.query("BEGIN");
			let allowed = true;
			for (const subject of ["global", `wallet:${wallet}`]) {
				const hash = createHmac("sha256", rateKeySecret)
					.update(`public-enroll:${subject}`)
					.digest("hex");
				const r = await c.query(
					"SELECT * FROM quest.take_passport_rate_limit($1,$2)",
					["enroll", hash],
				);
				if (r.rows.length !== 1 || typeof r.rows[0].allowed !== "boolean")
					fail();
				allowed = allowed && r.rows[0].allowed;
			}
			await c.query("COMMIT");
			if (!allowed) fail("RATE_LIMITED");
		} catch (e) {
			await c.query("ROLLBACK").catch(() => {});
			throw e;
		} finally {
			c.release();
		}
	}
	return {
		...auth,
		async issueWalletChallenge(input, context) {
			try {
				return await auth.issueWalletChallenge(input, context);
			} catch (e) {
				if (!(e instanceof PassportAuthFault) || e.code !== "UNAUTHORIZED")
					throw e;
			}
			await rate(input.wallet);
			const nonce = createNonce(),
				passportId = randomUUID();
			const r = await enrollmentPool.query(
				"SELECT * FROM quest.issue_passport_enrollment($1,$2,$3,$4,$5,$6)",
				[
					hashNonce(nonce),
					input.wallet,
					passportId,
					domain,
					environment.environmentId,
					environment.manifestSha256,
				],
			);
			if (r.rows.length !== 1) fail();
			const issuedAt = new Date(r.rows[0].issued_at).toISOString(),
				expiresAt = new Date(r.rows[0].expires_at).toISOString();
			return {
				network: "DEVNET",
				enrollment: true,
				expiresAt,
				message: buildChallengeMessage({
					network: "DEVNET",
					action: "passport.authenticate",
					domain,
					wallet: input.wallet,
					passportId,
					nonce,
					issuedAt,
					expiresAt,
				}),
			};
		},
		async enroll({ message, signature }, context) {
			if (
				typeof context?.clientKey !== "string" ||
				!context.clientKey ||
				context.clientKey.length > 256 ||
				[...context.clientKey].some(
					(c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
				)
			)
				fail("INVALID_REQUEST");
			let p;
			try {
				p = parseChallengeMessage(message);
			} catch {
				fail("INVALID_REQUEST");
			}
			if (
				p.network !== "DEVNET" ||
				p.domain !== domain ||
				buildChallengeMessage(p) !== message ||
				context.origin !== auth.origin
			)
				fail("FORBIDDEN");
			if (
				typeof signature !== "string" ||
				!/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
				Buffer.from(signature, "base64").toString("base64") !== signature
			)
				fail("INVALID_REQUEST");
			await rate(p.wallet);
			if (!verifyPassportSignature(p.wallet, message, signature))
				fail("UNAUTHORIZED");
			const evidence = createHash("sha256")
				.update(`solve3:devnet:self-service:${p.wallet}:${hashNonce(p.nonce)}`)
				.digest("hex");
			const r = await enrollmentPool.query(
				"SELECT quest.complete_passport_enrollment($1,$2,$3,$4,$5,$6,$7,$8,$9) AS completed",
				[
					hashNonce(p.nonce),
					p.wallet,
					p.passportId,
					p.domain,
					p.issuedAt,
					p.expiresAt,
					environment.environmentId,
					environment.manifestSha256,
					evidence,
				],
			);
			if (r.rows.length !== 1 || r.rows[0].completed !== true)
				fail("UNAUTHORIZED");
			return auth.authenticate({ message, signature }, context);
		},
	};
}
