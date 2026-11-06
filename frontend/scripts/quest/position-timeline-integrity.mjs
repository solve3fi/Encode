import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const TIMELINE_VERSION = "position-timeline-v1";
export function timelineFail(message) {
	throw new Error(`Position timeline: ${message}`);
}
export function timelineHash(value) {
	const canonical = (v) => {
		if (v === null || ["string", "boolean"].includes(typeof v)) return v;
		if (typeof v === "number" && Number.isSafeInteger(v)) return v;
		if (Array.isArray(v)) return v.map(canonical);
		if (v && Object.getPrototypeOf(v) === Object.prototype)
			return Object.fromEntries(
				Object.keys(v)
					.sort()
					.map((k) => [k, canonical(v[k])]),
			);
		timelineFail("plain exact JSON required");
	};
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
}
export function timelineKey(v) {
	if (typeof v !== "string" || new PublicKey(v).toBase58() !== v)
		timelineFail("canonical address required");
	return v;
}
export function timelineInteger(v) {
	if (!Number.isSafeInteger(v) || v < 0 || v >= Number.MAX_SAFE_INTEGER)
		timelineFail("safe nonnegative integer required");
	return v;
}
export function timelineClock(anchor, block) {
	timelineKey(block?.blockhash);
	const time = timelineInteger(block?.blockTime);
	if (time > 8_640_000_000_000) timelineFail("clock outside timestamp range");
	const clock = {
		network: anchor.network,
		campaignId: anchor.campaignId,
		manifestSha256: anchor.manifestSha256,
		anchorSlot: anchor.anchorSlot,
		blockhash: block.blockhash,
		blockTimeSeconds: time,
		finality: "finalized",
		schemaVersion: 1,
	};
	return { ...clock, clockSha256: timelineHash(clock) };
}
