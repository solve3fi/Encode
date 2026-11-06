import { readFileSync } from "node:fs";

const APPROVED_MANIFEST_PIN_PATTERN = /^[0-9a-f]{64}$/;

function readApprovedText(path, missingError) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error && error.code === "ENOENT") {
			throw missingError;
		}
		throw new Error("Quest startup could not read approved inputs");
	}
}

/**
 * Read the approved Quest startup inputs from disk.
 *
 * The manifest is returned verbatim as a byte string and the pin is returned
 * as a separately supplied reviewed SHA-256 digest (trimmed and validated).
 * This function does not parse, approve, or log the manifest, and read
 * failures are wrapped without exposing file contents or paths.
 */
export function loadManifestInputs({
	manifestPath,
	pinPath,
	maxBytes = 65536,
}) {
	const manifestJson = readApprovedText(
		manifestPath,
		new Error("Quest startup could not read approved inputs"),
	);
	const manifestBytes = Buffer.byteLength(manifestJson, "utf8");
	if (manifestBytes < 1 || manifestBytes > maxBytes) {
		throw new Error("Quest startup requires manifest bytes");
	}
	const pinText = readApprovedText(
		pinPath,
		new Error("Quest startup requires an approved manifest pin"),
	);
	const approvedManifestSha256 = pinText.trim();
	if (!APPROVED_MANIFEST_PIN_PATTERN.test(approvedManifestSha256)) {
		throw new Error("Quest startup requires an approved manifest pin");
	}
	return { manifestJson, approvedManifestSha256 };
}
