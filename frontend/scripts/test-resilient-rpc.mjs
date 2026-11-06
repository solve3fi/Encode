import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createResilientConnection, createResilientFetch, parseRpcUrls, retryDelayMs } from "./lib/resilient-rpc.mjs";

const respond = (status, body = "{}", headers = {}) => new Response(body, { status, headers });
const fast = { wait: async () => {}, random: () => 0.5 };

test("urls are trimmed, de-duplicated and the primary stays first", () => {
	assert.deepEqual(parseRpcUrls("https://a", " https://b , https://a,,"), ["https://a", "https://b"]);
	assert.deepEqual(parseRpcUrls("https://a", undefined), ["https://a"]);
});

test("backoff doubles, is capped, and honours Retry-After", () => {
	const mid = () => 0.5;
	assert.equal(retryDelayMs(0, null, 400, 8000, mid), 400);
	assert.equal(retryDelayMs(2, null, 400, 8000, mid), 1600);
	assert.equal(retryDelayMs(10, null, 400, 8000, mid), 8000);
	assert.equal(retryDelayMs(0, "3", 400, 8000, mid), 3000);
	assert.equal(retryDelayMs(0, "99", 400, 8000, mid), 8000);
});

test("429 and 5xx are retried on the same endpoint until it recovers", async () => {
	const statuses = [429, 503, 200];
	const calls = [];
	const run = createResilientFetch(["https://only"], {
		...fast,
		fetchImpl: async (url) => {
			calls.push(url);
			return respond(statuses.shift());
		},
	});
	assert.equal((await run("x", { body: "{}" })).status, 200);
	assert.equal(calls.length, 3);
});

test("a failing endpoint rotates to the fallback and the working one is remembered", async () => {
	const calls = [];
	const run = createResilientFetch(["https://bad", "https://good"], {
		...fast,
		fetchImpl: async (url) => {
			calls.push(url);
			if (url === "https://bad") throw new Error("ECONNRESET");
			return respond(200);
		},
	});
	assert.equal((await run("x", {})).status, 200);
	assert.deepEqual(calls, ["https://bad", "https://good"]);
	await run("x", {});
	assert.equal(calls.at(-1), "https://good");
	assert.equal(calls.length, 3);
});

test("non-retryable statuses return immediately and the error surfaces after the last attempt", async () => {
	let n = 0;
	const client = createResilientFetch(["https://x"], { ...fast, fetchImpl: async () => (n++, respond(400)) });
	assert.equal((await client("x", {})).status, 400);
	assert.equal(n, 1);
	let m = 0;
	const dead = createResilientFetch(["https://x"], { ...fast, attempts: 3, fetchImpl: async () => (m++, respond(429)) });
	await assert.rejects(dead("x", {}), /HTTP 429/);
	assert.equal(m, 3);
});

test("a Connection survives two 429s from a real HTTP server", async () => {
	let hits = 0;
	const server = createServer((req, res) => {
		hits++;
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			if (hits <= 2) {
				res.writeHead(429, { "retry-after": "0" });
				res.end("slow down");
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(body).id, result: 123456 }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const connection = createResilientConnection(`http://127.0.0.1:${server.address().port}`, "confirmed", {
			...fast,
			baseMs: 1,
		});
		assert.equal(await connection.getSlot("confirmed"), 123456);
		assert.equal(hits, 3);
	} finally {
		server.close();
	}
});
