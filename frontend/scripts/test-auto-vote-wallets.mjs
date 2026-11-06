import fs from "node:fs";
import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

const ADMIN_KEYPAIR_PATH = "../ve33-contracts/id.json";
const BASE_URL = "http://localhost:3000";
const PREFIX = "solve3 admin action:";

const canonicalize = (value) => {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, v]) => [k, canonicalize(v)]),
		);
	}
	return value ?? null;
};

const sign = (admin, action, payload = {}) => {
	const timestamp = Date.now();
	const hash = createHash("sha256")
		.update(Buffer.from(JSON.stringify(canonicalize(payload)), "utf8"))
		.digest("hex");
	const message = `${PREFIX} ${action} | ${timestamp} | ${hash}`;
	const signature = nacl.sign.detached(
		Buffer.from(message, "utf8"),
		admin.secretKey,
	);
	return {
		wallet: admin.publicKey.toString(),
		message,
		signature: Buffer.from(signature).toString("base64"),
	};
};

const admin = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf8"))),
);
console.log("admin:", admin.publicKey.toString());

const testWallet = Keypair.generate();
console.log("test wallet:", testWallet.publicKey.toString());

const pools = [{ poolAddress: testWallet.publicKey.toString(), percent: 60 }];

// 1. Add
{
	const auth = sign(admin, "add admin auto-vote wallet", {
		secretKey: JSON.stringify(Array.from(testWallet.secretKey)),
		label: "test wallet",
		pools,
	});
	const res = await fetch(`${BASE_URL}/api/admin/auto-vote-wallets`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...auth,
			secretKey: JSON.stringify(Array.from(testWallet.secretKey)),
			label: "test wallet",
			pools,
		}),
	});
	const data = await res.json();
	console.log("POST status:", res.status, JSON.stringify(data));
	if (res.status !== 200) throw new Error("POST failed");
	if (JSON.stringify(data).includes(JSON.stringify(Array.from(testWallet.secretKey)))) {
		throw new Error("SECURITY BUG: secret key leaked in response");
	}
}

// 2. GET reflects it, no secret key anywhere
{
	const res = await fetch(`${BASE_URL}/api/admin/auto-vote-wallets`);
	const data = await res.json();
	const raw = JSON.stringify(data);
	console.log("GET status:", res.status, "has entry:", !!data[testWallet.publicKey.toString()]);
	if (raw.includes("encryptedSecretKey") || raw.toLowerCase().includes("ciphertext")) {
		throw new Error("SECURITY BUG: encrypted secret key material exposed via GET");
	}
}

// 3. Check the on-disk store actually encrypted it (not plaintext)
{
	const store = JSON.parse(
		fs.readFileSync("data/admin-auto-vote-wallets.json", "utf8"),
	);
	const record = store[testWallet.publicKey.toString()];
	const storedSecretArray = JSON.stringify(Array.from(testWallet.secretKey));
	if (!record.encryptedSecretKey?.ciphertext) {
		throw new Error("No ciphertext found on disk");
	}
	if (JSON.stringify(record).includes(storedSecretArray)) {
		throw new Error("SECURITY BUG: plaintext secret key found on disk");
	}
	console.log("on-disk record encrypted correctly:", record.encryptedSecretKey);
}

// 4. Update pools
{
	const newPools = [{ poolAddress: testWallet.publicKey.toString(), percent: 30 }];
	const auth = sign(admin, "update admin auto-vote wallet", {
		pubkey: testWallet.publicKey.toString(),
		label: "",
		pools: newPools,
	});
	const res = await fetch(`${BASE_URL}/api/admin/auto-vote-wallets`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...auth,
			pubkey: testWallet.publicKey.toString(),
			pools: newPools,
		}),
	});
	const data = await res.json();
	console.log("PATCH status:", res.status, JSON.stringify(data));
	if (res.status !== 200) throw new Error("PATCH failed");
	if (data.wallet.pools[0].percent !== 30) throw new Error("Update didn't apply");
}

// 5. Reject a non-admin signer
{
	const stranger = Keypair.generate();
	const auth = sign(stranger, "remove admin auto-vote wallet", {
		pubkey: testWallet.publicKey.toString(),
	});
	const res = await fetch(`${BASE_URL}/api/admin/auto-vote-wallets`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...auth, pubkey: testWallet.publicKey.toString() }),
	});
	console.log("DELETE (non-admin) status:", res.status);
	if (res.status !== 401) throw new Error("Non-admin delete should have been rejected");
}

// 6. Remove (real admin)
{
	const auth = sign(admin, "remove admin auto-vote wallet", {
		pubkey: testWallet.publicKey.toString(),
	});
	const res = await fetch(`${BASE_URL}/api/admin/auto-vote-wallets`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...auth, pubkey: testWallet.publicKey.toString() }),
	});
	const data = await res.json();
	console.log("DELETE status:", res.status, JSON.stringify(data));
	if (res.status !== 200) throw new Error("DELETE failed");
}

console.log("\nAll checks passed.");
