import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

// Minimal file-based JSON store for devnet-only state (faucet cooldowns,
// airdrop allocations/claims). Reads and writes a single JSON file per
// store under <project root>/data/, created on first write. This is NOT a
// real database: it has no cross-process locking and won't survive or
// share state across multiple serverless instances (e.g. on Vercel) — fine
// for local dev / a single long-running server, but replace with a real
// datastore (Vercel KV/Postgres) before a multi-instance production deploy.
const DATA_DIR = path.join(process.cwd(), "data");

async function ensureDataDir() {
	await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readStore<T>(name: string, fallback: T): Promise<T> {
	try {
		const raw = await fs.readFile(path.join(DATA_DIR, `${name}.json`), "utf8");
		return JSON.parse(raw) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
		throw error;
	}
}

// Not safe under true concurrent writers, but claims here are rare/human-
// paced (devnet faucet + airdrop), so a plain read-modify-write is enough.
export async function writeStore<T>(name: string, data: T): Promise<void> {
	await ensureDataDir();
	await fs.writeFile(
		path.join(DATA_DIR, `${name}.json`),
		JSON.stringify(data, null, 2),
		"utf8",
	);
}
