import { withQuestDevnetStartup } from "./devnet-startup-adapter.mjs";
import { loadManifestInputs } from "./startup-manifest.mjs";

/**
 * Dormant read-only preflight boundary for a future Devnet worker. The caller
 * must supply a separately approved manifest and its independently approved
 * pin (via `manifestPath`/`pinPath`); this function does not approve, parse, or
 * invent either. It loads those approved inputs through the injected loader,
 * then runs the injected read-only startup adapter and returns its
 * `{ receipt, value }` result. It performs no I/O of its own beyond the
 * injected loader, makes no network calls on import, contains no credentials or
 * default connection, and starts or awards nothing.
 */
export async function runQuestDevnetPreflight({
	manifestPath,
	pinPath,
	maxManifestBytes,
	rpcUrl,
	openDatabase,
	work,
	collectInventory,
	clock,
	loadInputs = loadManifestInputs,
	runStartup = withQuestDevnetStartup,
}) {
	const { manifestJson, approvedManifestSha256 } = await loadInputs({
		manifestPath,
		pinPath,
		...(maxManifestBytes !== undefined ? { maxBytes: maxManifestBytes } : {}),
	});
	return runStartup({
		manifestJson,
		approvedManifestSha256,
		...(rpcUrl !== undefined ? { rpcUrl } : {}),
		...(openDatabase !== undefined ? { openDatabase } : {}),
		...(work !== undefined ? { work } : {}),
		...(collectInventory !== undefined ? { collectInventory } : {}),
		...(clock !== undefined ? { clock } : {}),
	});
}
