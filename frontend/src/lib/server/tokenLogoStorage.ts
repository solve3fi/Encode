import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

// Uploaded token-request logos — same writable, Docker-volume-mounted
// data/ directory dataStore.ts uses for JSON state, so no new infra is
// needed to persist these across deploys/restarts.
const LOGO_DIR = path.join(process.cwd(), "data", "token-logos");

export async function saveTokenLogo(
	filename: string,
	bytes: Buffer,
): Promise<void> {
	await fs.mkdir(LOGO_DIR, { recursive: true });
	await fs.writeFile(path.join(LOGO_DIR, filename), bytes);
}

export async function readTokenLogo(filename: string): Promise<Buffer | null> {
	try {
		return await fs.readFile(path.join(LOGO_DIR, filename));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
