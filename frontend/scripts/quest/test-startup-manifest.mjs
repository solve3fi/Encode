import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadManifestInputs } from "./startup-manifest.mjs";

// TEST-ONLY identifiers. A real pin is an independently reviewed manifest
// SHA-256 digest; this fixture approves no manifest by itself.
const APPROVED_PIN =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b75542fd3";

function setupFiles(t, { manifest, pin } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "quest-startup-manifest-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const manifestPath = join(dir, "manifest.json");
	const pinPath = join(dir, "pin.txt");
	if (manifest !== undefined) writeFileSync(manifestPath, manifest);
	if (pin !== undefined) writeFileSync(pinPath, pin);
	return { manifestPath, pinPath };
}

test("valid files return the exact manifest bytes and approved pin", (t) => {
	const manifest = '{"network":"DEVNET","note":"exact bytes ✓"}';
	const { manifestPath, pinPath } = setupFiles(t, {
		manifest,
		pin: APPROVED_PIN,
	});
	assert.deepEqual(loadManifestInputs({ manifestPath, pinPath }), {
		manifestJson: manifest,
		approvedManifestSha256: APPROVED_PIN,
	});
});

test("a manifest of exactly maxBytes is accepted", (t) => {
	const manifest = "x".repeat(65536);
	const { manifestPath, pinPath } = setupFiles(t, {
		manifest,
		pin: APPROVED_PIN,
	});
	assert.equal(
		loadManifestInputs({ manifestPath, pinPath }).manifestJson,
		manifest,
	);
});

test("a manifest over a custom maxBytes is rejected", (t) => {
	const { manifestPath, pinPath } = setupFiles(t, {
		manifest: "xxxxxxxxxx",
		pin: APPROVED_PIN,
	});
	assert.throws(
		() => loadManifestInputs({ manifestPath, pinPath, maxBytes: 4 }),
		/Quest startup requires manifest bytes/,
	);
});

test("missing manifest file throws", (t) => {
	const { manifestPath, pinPath } = setupFiles(t, { pin: APPROVED_PIN });
	assert.throws(
		() => loadManifestInputs({ manifestPath, pinPath }),
		/Quest startup could not read approved inputs/,
	);
});

test("empty manifest throws", (t) => {
	const { manifestPath, pinPath } = setupFiles(t, {
		manifest: "",
		pin: APPROVED_PIN,
	});
	assert.throws(
		() => loadManifestInputs({ manifestPath, pinPath }),
		/Quest startup requires manifest bytes/,
	);
});

test("oversized manifest throws", (t) => {
	const { manifestPath, pinPath } = setupFiles(t, {
		manifest: "x".repeat(65537),
		pin: APPROVED_PIN,
	});
	assert.throws(
		() => loadManifestInputs({ manifestPath, pinPath }),
		/Quest startup requires manifest bytes/,
	);
});

test("missing pin file throws", (t) => {
	const { manifestPath, pinPath } = setupFiles(t, { manifest: "{}" });
	assert.throws(
		() => loadManifestInputs({ manifestPath, pinPath }),
		/Quest startup requires an approved manifest pin/,
	);
});

test("non-hex pin throws", (t) => {
	const { manifestPath, pinPath } = setupFiles(t, {
		manifest: "{}",
		pin: "g".repeat(64),
	});
	assert.throws(
		() => loadManifestInputs({ manifestPath, pinPath }),
		/Quest startup requires an approved manifest pin/,
	);
});

test("uppercase-hex pin is rejected", (t) => {
	const { manifestPath, pinPath } = setupFiles(t, {
		manifest: "{}",
		pin: APPROVED_PIN.toUpperCase(),
	});
	assert.throws(
		() => loadManifestInputs({ manifestPath, pinPath }),
		/Quest startup requires an approved manifest pin/,
	);
});

test("pin file with a trailing newline is accepted", (t) => {
	const { manifestPath, pinPath } = setupFiles(t, {
		manifest: "{}",
		pin: `${APPROVED_PIN}\n`,
	});
	assert.equal(
		loadManifestInputs({ manifestPath, pinPath }).approvedManifestSha256,
		APPROVED_PIN,
	);
});
