import assert from "node:assert/strict";
import { test } from "node:test";
import { runQuestDevnetPreflight } from "./devnet-preflight.mjs";

// All paths, bytes, callbacks and seams here are test-only, never deployment
// input. The preflight is a dormant boundary: it loads approved inputs through
// an injected loader and forwards them to an injected read-only adapter.
const MANIFEST_JSON = '{"version":1,"network":"TEST_ONLY_DEVNET"}';
const APPROVED_SHA = "c".repeat(64);

function fixture() {
	const manifestPath = "/TEST_ONLY/approved-manifest.json";
	const pinPath = "/TEST_ONLY/approved-manifest.sha256";
	const maxManifestBytes = 4096;
	const rpcUrl = "https://devnet.example.test/rpc";
	const loadCalls = [];
	const startupCalls = [];
	const loadInputs = async (args) => {
		loadCalls.push(args);
		return {
			manifestJson: MANIFEST_JSON,
			approvedManifestSha256: APPROVED_SHA,
		};
	};
	const openDatabase = async () => "TEST_DB_FACTORY";
	const collectInventory = async () => "TEST_INVENTORY";
	const clock = () => 123;
	const work = async () => "TEST_WORK";
	const runStartup = async (args) => {
		startupCalls.push(args);
		return { receipt: { network: "DEVNET" }, value: "done" };
	};
	const options = {
		manifestPath,
		pinPath,
		maxManifestBytes,
		rpcUrl,
		openDatabase,
		work,
		collectInventory,
		clock,
		loadInputs,
		runStartup,
	};
	return {
		options,
		loadCalls,
		startupCalls,
		loadInputs,
		runStartup,
		openDatabase,
		work,
		collectInventory,
		clock,
		manifestPath,
		pinPath,
		maxManifestBytes,
		rpcUrl,
	};
}

test("forwards the exact approved inputs and seams to the adapter", async () => {
	const {
		options,
		loadCalls,
		startupCalls,
		openDatabase,
		work,
		collectInventory,
		clock,
		manifestPath,
		pinPath,
		maxManifestBytes,
		rpcUrl,
	} = fixture();
	const result = await runQuestDevnetPreflight(options);
	assert.equal(result.value, "done");
	assert.deepEqual(result.receipt, { network: "DEVNET" });
	assert.equal(loadCalls.length, 1);
	assert.deepEqual(loadCalls[0], {
		manifestPath,
		pinPath,
		maxBytes: maxManifestBytes,
	});
	assert.equal(startupCalls.length, 1);
	const forwarded = startupCalls[0];
	// Exact manifest bytes and independently approved pin, not a re-encoding.
	assert.equal(forwarded.manifestJson, MANIFEST_JSON);
	assert.equal(forwarded.approvedManifestSha256, APPROVED_SHA);
	assert.equal(forwarded.rpcUrl, rpcUrl);
	// Callback and seam references are forwarded by identity, unchanged.
	assert.equal(forwarded.openDatabase, openDatabase);
	assert.equal(forwarded.work, work);
	assert.equal(forwarded.collectInventory, collectInventory);
	assert.equal(forwarded.clock, clock);
	assert.deepEqual(Object.keys(forwarded).sort(), [
		"approvedManifestSha256",
		"clock",
		"collectInventory",
		"manifestJson",
		"openDatabase",
		"rpcUrl",
		"work",
	]);
});

test("returns the adapter's { receipt, value } unchanged", async () => {
	const { options } = fixture();
	const receipt = { network: "DEVNET", finalizedSlot: 7 };
	const result = await runQuestDevnetPreflight({
		...options,
		runStartup: async () => ({ receipt, value: 42 }),
	});
	assert.equal(result.value, 42);
	assert.equal(result.receipt, receipt);
});

test("does not call the adapter when the loader fails", async () => {
	const { options, startupCalls } = fixture();
	options.loadInputs = async () => {
		throw new Error("TEST_ONLY approved inputs unavailable");
	};
	await assert.rejects(
		runQuestDevnetPreflight(options),
		/TEST_ONLY approved inputs unavailable/,
	);
	assert.deepEqual(startupCalls, []);
});

test("passes a non-function work through so the adapter can reject it", async () => {
	const { options, startupCalls } = fixture();
	options.work = "TEST_ONLY_NOT_A_FUNCTION";
	await runQuestDevnetPreflight(options);
	assert.equal(startupCalls.length, 1);
	assert.equal(startupCalls[0].work, "TEST_ONLY_NOT_A_FUNCTION");
});
