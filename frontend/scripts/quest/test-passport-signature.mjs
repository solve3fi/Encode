import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { verifyPassportSignature } from "./passport-signature.mjs";

const MESSAGE =
	"solve3 quest passport authentication\nnetwork: DEVNET\n" +
	"domain: quest.solve3.xyz\naction: passport.authenticate";

const keyPair = nacl.sign.keyPair();
const WALLET = bs58.encode(keyPair.publicKey);
const SIGNATURE = Buffer.from(
	nacl.sign.detached(new TextEncoder().encode(MESSAGE), keyPair.secretKey),
).toString("base64");
const OTHER_MESSAGE =
	"solve3 quest passport authentication\nnetwork: DEVNET\n" +
	"domain: quest.solve3.xyz\naction: passport.authenticate\nreissued";
const OTHER_SIGNATURE = Buffer.from(
	nacl.sign.detached(
		new TextEncoder().encode(OTHER_MESSAGE),
		keyPair.secretKey,
	),
).toString("base64");

test("module imports no filesystem, network or database driver", () => {
	const source = readFileSync(
		fileURLToPath(new URL("./passport-signature.mjs", import.meta.url)),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/node:fs|node:net|node:http|node:dns|fetch\(|WebSocket/i,
	);
	assert.doesNotMatch(source, /from\s+["']pg["']|postgres|mysql|sqlite/i);
});

test("a real nacl keypair signature over the message verifies true", () => {
	assert.equal(typeof verifyPassportSignature, "function");
	assert.equal(verifyPassportSignature(WALLET, MESSAGE, SIGNATURE), true);
});

test("tampered message returns false", () => {
	assert.equal(
		verifyPassportSignature(WALLET, `${MESSAGE} `, SIGNATURE),
		false,
	);
	assert.equal(
		verifyPassportSignature(WALLET, `${MESSAGE.slice(0, -1)}x`, SIGNATURE),
		false,
	);
});

test("a valid signature over a different message returns false", () => {
	assert.equal(
		verifyPassportSignature(WALLET, OTHER_MESSAGE, SIGNATURE),
		false,
	);
	assert.equal(
		verifyPassportSignature(WALLET, OTHER_MESSAGE, OTHER_SIGNATURE),
		true,
	);
	assert.equal(
		verifyPassportSignature(WALLET, MESSAGE, OTHER_SIGNATURE),
		false,
	);
});

test("malformed base64 signature returns false without throwing", () => {
	assert.doesNotThrow(() => {
		assert.equal(
			verifyPassportSignature(WALLET, MESSAGE, "not base64!!!"),
			false,
		);
		assert.equal(verifyPassportSignature(WALLET, MESSAGE, ""), false);
		// Valid base64 characters but decodes to the wrong number of bytes.
		assert.equal(verifyPassportSignature(WALLET, MESSAGE, "AQID"), false);
		// Valid base64 but truncated (decodes to 30 bytes).
		assert.equal(
			verifyPassportSignature(WALLET, MESSAGE, SIGNATURE.slice(0, 40)),
			false,
		);
	});
});

test("short and long signatures return false without throwing", () => {
	const signatureBytes = Buffer.from(SIGNATURE, "base64");
	assert.equal(signatureBytes.length, nacl.sign.signatureLength);
	assert.doesNotThrow(() => {
		assert.equal(
			verifyPassportSignature(
				WALLET,
				MESSAGE,
				signatureBytes.subarray(0, 63).toString("base64"),
			),
			false,
		);
		assert.equal(
			verifyPassportSignature(
				WALLET,
				MESSAGE,
				Buffer.concat([signatureBytes, Buffer.from([0])]).toString("base64"),
			),
			false,
		);
	});
});

test("invalid base58 wallet returns false without throwing", () => {
	assert.doesNotThrow(() => {
		assert.equal(
			verifyPassportSignature("invalid-wallet!!!", MESSAGE, SIGNATURE),
			false,
		);
		assert.equal(
			verifyPassportSignature(`0OIl${"1".repeat(28)}`, MESSAGE, SIGNATURE),
			false,
		);
		// Valid base58 characters but the wrong byte length (not 32 bytes).
		assert.equal(
			verifyPassportSignature("1".repeat(31), MESSAGE, SIGNATURE),
			false,
		);
		assert.equal(
			verifyPassportSignature(
				`${bs58.encode(keyPair.publicKey)}1`,
				MESSAGE,
				SIGNATURE,
			),
			false,
		);
	});
});

test("wrong wallet for the signature returns false", () => {
	const otherKeyPair = nacl.sign.keyPair();
	assert.equal(
		verifyPassportSignature(
			bs58.encode(otherKeyPair.publicKey),
			MESSAGE,
			SIGNATURE,
		),
		false,
	);
});
