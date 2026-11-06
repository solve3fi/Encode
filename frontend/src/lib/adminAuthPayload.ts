// Deterministic byte encoding of an admin-action payload, shared by
// useAdminAuth (client, hashes with WebCrypto) and requireAdmin (server,
// hashes with node:crypto) so both sides sign/verify identical bytes
// regardless of the insertion order of the caller's object literal — see
// requireAdmin.ts for why the hash exists.
function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(
			([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
		);
		return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
	}
	return value ?? null;
}

export function encodeAdminPayload(payload: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(canonicalize(payload)));
}

export const toHex = (buffer: ArrayBuffer): string =>
	Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
