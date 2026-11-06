// Isolated HTTP-handler tests. Auth and storage are explicit test doubles;
// no production wallet, network, filesystem ledger, or token transfer is used.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as parser from "../src/lib/airdropSnapshot.ts";

const csv = readFileSync(process.argv[2]);
function harness() {
	const stores = { "airdrop-allocations": {} };
	const writes = [];
	const auth = [];
	const imports = {
		"next/server": { NextResponse: { json: (value, init) => Response.json(value, init) } },
		"@/lib/airdropSnapshot": parser,
		"@/lib/server/dataStore": {
			readStore: async (key, fallback) => structuredClone(stores[key] ?? fallback),
			writeStore: async (key, value) => { writes.push(key); stores[key] = structuredClone(value); },
		},
		"@/lib/server/requireAdmin": { requireAdmin: (input, action) => {
			auth.push(action);
			if (input.signature !== "test-authorized") throw new Error("Not authorized");
		} },
	};
	const output = ts.transpileModule(readFileSync(new URL("../src/app/api/airdrop/upload/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
	const handlers = {};
	new Function("require", "exports", output)((id) => {
		if (!(id in imports)) throw new Error(`Unexpected route dependency: ${id}`);
		return imports[id];
	}, handlers);
	return { stores, writes, auth, handlers };
}
function request(content = csv, signature = "test-authorized") {
	const form = new FormData();
	form.append("wallet", "test-wallet"); form.append("message", "test-message"); form.append("signature", signature);
	form.append("file", new File([content], "recipients.csv"));
	return new Request("http://isolated.test/api/airdrop/upload", { method: "POST", body: form });
}

test("page multipart upload accepts actual CSV; repeat upload replaces draft without changing live ledger", async () => {
	const h = harness();
	for (let i = 0; i < 2; i++) {
		const response = await h.handlers.POST(request());
		assert.equal(response.status, 200);
		const result = await response.json();
		assert.equal(result.draft, true); assert.equal(result.totalAllocations, 4252);
		assert.equal(result.totalAmount, 7000000); assert.equal(result.reservedAmount, 3000000);
	}
	assert.deepEqual(h.writes, ["airdrop-draft", "airdrop-draft"]);
	assert.deepEqual(h.stores["airdrop-allocations"], {});
	assert.deepEqual(h.auth, ["upload airdrop", "upload airdrop"]);
	const summary = await (await h.handlers.GET()).json();
	assert.equal(summary.draft.total, 4252); assert.equal(summary.total, 0);
});
test("unauthorized and malformed uploads do not write any data", async () => {
	const h = harness();
	assert.equal((await h.handlers.POST(request(csv, "wrong"))).status, 401);
	assert.equal((await h.handlers.POST(request("bad,headers\n1,2"))).status, 400);
	assert.deepEqual(h.writes, []);
});
