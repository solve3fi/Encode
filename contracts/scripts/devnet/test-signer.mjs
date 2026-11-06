#!/usr/bin/env node
// DEVNET UI-TEST ONLY. A local signer for the throwaway rehearsal wallets so a browser test can sign
// without any key entering the browser, the repo or a chat. Binds to 127.0.0.1 only.
//   node scripts/devnet/test-signer.mjs      (port 3300)
// GET  /wallets                      -> [{name, pubkey}]
// POST /sign        {wallet, txs:[base64]}      -> {txs:[base64 signed]}
// POST /signMessage {wallet, message: base64}   -> {signature: base64}
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519";
import { Keypair, VersionedTransaction } from "@solana/web3.js";

const dir = `${process.env.HOME}/.solve3-devnet-keys/${process.env.REHEARSAL_DIR ?? "live"}/wallets`;
const wallets = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
	wallets[f.replace(/\.json$/, "")] = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${dir}/${f}`, "utf8"))));
}
const PORT = Number(process.env.SIGNER_PORT ?? 3300);
const allowedOrigin = (o) => !!o && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

const server = createServer(async (req, res) => {
	const origin = req.headers.origin;
	if (allowedOrigin(origin)) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Headers", "content-type");
		res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
		res.setHeader("Access-Control-Allow-Private-Network", "true");
	}
	if (req.method === "OPTIONS") return res.writeHead(204).end();
	if (!allowedOrigin(origin) && req.method !== "GET") return res.writeHead(403).end("forbidden origin");
	const json = (code, body) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
	try {
		if (req.method === "GET" && req.url === "/wallets") return json(200, Object.entries(wallets).map(([name, kp]) => ({ name, pubkey: kp.publicKey.toBase58() })));
		let body = "";
		for await (const chunk of req) body += chunk;
		const data = JSON.parse(body || "{}");
		const kp = wallets[data.wallet];
		if (!kp) return json(404, { error: "unknown wallet" });
		if (req.url === "/sign") {
			const txs = data.txs.map((b64) => {
				const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
				tx.sign([kp]);
				return Buffer.from(tx.serialize()).toString("base64");
			});
			console.log(new Date().toISOString(), "signed", txs.length, "tx for", data.wallet);
			return json(200, { txs });
		}
		if (req.url === "/signMessage") {
			const sig = ed25519.sign(Buffer.from(data.message, "base64"), kp.secretKey.slice(0, 32));
			console.log(new Date().toISOString(), "signed message for", data.wallet);
			return json(200, { signature: Buffer.from(sig).toString("base64") });
		}
		return json(404, { error: "not found" });
	} catch (e) {
		return json(500, { error: String(e.message ?? e) });
	}
});
server.listen(PORT, "127.0.0.1", () => console.log(`test signer on 127.0.0.1:${PORT} with wallets: ${Object.keys(wallets).join(", ")}`));
