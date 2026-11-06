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
	const signature = nacl.sign.detached(Buffer.from(message, "utf8"), admin.secretKey);
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
const testPool = Keypair.generate().publicKey.toString();

// 1. Set accelerator wallet
{
	const auth = sign(admin, "set accelerator wallet", {
		acceleratorWalletPubkey: testWallet.publicKey.toString(),
	});
	const res = await fetch(`${BASE_URL}/api/admin/accelerator-config`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...auth, acceleratorWalletPubkey: testWallet.publicKey.toString() }),
	});
	const data = await res.json();
	console.log("set wallet status:", res.status, JSON.stringify(data));
	if (res.status !== 200) throw new Error("set wallet failed");
}

// 2. Enroll partner
{
	const auth = sign(admin, "add accelerator partner", {
		poolAddress: testPool,
		projectName: "Test Protocol",
		enrolledAtEpoch: 3,
		maxEpochs: 4,
		notes: "",
	});
	const res = await fetch(`${BASE_URL}/api/admin/accelerator-partners`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...auth,
			poolAddress: testPool,
			projectName: "Test Protocol",
			enrolledAtEpoch: 3,
			maxEpochs: 4,
		}),
	});
	const data = await res.json();
	console.log("enroll status:", res.status, JSON.stringify(data));
	if (res.status !== 200) throw new Error("enroll failed");
}

// 3. GET reflects both
{
	const config = await (await fetch(`${BASE_URL}/api/admin/accelerator-config`)).json();
	const partners = await (await fetch(`${BASE_URL}/api/admin/accelerator-partners`)).json();
	console.log("config:", JSON.stringify(config));
	console.log("has partner:", !!partners[testPool], "status:", partners[testPool]?.status);
	if (!partners[testPool] || partners[testPool].status !== "active") {
		throw new Error("partner not reflected correctly");
	}
}

// 4. Reject non-admin
{
	const stranger = Keypair.generate();
	const auth = sign(stranger, "remove accelerator partner", { poolAddress: testPool });
	const res = await fetch(`${BASE_URL}/api/admin/accelerator-partners`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...auth, poolAddress: testPool }),
	});
	console.log("non-admin delete status:", res.status);
	if (res.status !== 401) throw new Error("non-admin delete should have been rejected");
}

// 5. Mark completed
{
	const auth = sign(admin, "update accelerator partner", {
		poolAddress: testPool,
		status: "completed",
		maxEpochs: 0,
		notes: "",
	});
	const res = await fetch(`${BASE_URL}/api/admin/accelerator-partners`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...auth, poolAddress: testPool, status: "completed" }),
	});
	const data = await res.json();
	console.log("mark completed status:", res.status, JSON.stringify(data));
	if (res.status !== 200 || data.partner.status !== "completed") throw new Error("update failed");
}

// 6. Remove (real admin)
{
	const auth = sign(admin, "remove accelerator partner", { poolAddress: testPool });
	const res = await fetch(`${BASE_URL}/api/admin/accelerator-partners`, {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...auth, poolAddress: testPool }),
	});
	const data = await res.json();
	console.log("remove status:", res.status, JSON.stringify(data));
	if (res.status !== 200) throw new Error("remove failed");
}

// 7. Clear accelerator wallet (cleanup)
{
	const auth = sign(admin, "set accelerator wallet", { acceleratorWalletPubkey: "" });
	await fetch(`${BASE_URL}/api/admin/accelerator-config`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...auth, acceleratorWalletPubkey: "" }),
	});
}

console.log("\nAll checks passed.");
