import { createHash } from "node:crypto";

type JsonValue =
	| null
	| boolean
	| string
	| number
	| JsonValue[]
	| { [key: string]: JsonValue };

export type GenesisChainEventRecord = {
	campaignId: string;
	cluster: "localnet" | "devnet" | "testnet" | "mainnet-beta";
	signature: string;
	instructionIndex: number;
	eventIndex: number;
	eventKind:
		| "swap"
		| "position_open"
		| "liquidity_increase"
		| "liquidity_decrease"
		| "position_close";
	slot: number;
	blockTimeSeconds: number;
	wallet: string;
	poolAddress: string | null;
	positionAddress: string | null;
	/** Atomic token amounts and exact prices must be decimal strings. */
	payload: { [key: string]: JsonValue };
};

/** Canonical JSON for equality checks only; this does not verify chain data. */
function canonicalJson(value: JsonValue): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value)) {
			throw new TypeError("Genesis event numbers must be safe integers.");
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError("Genesis event payload must be plain JSON.");
	}
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
		.join(",")}}`;
}

export function fingerprintGenesisEvent(event: GenesisChainEventRecord) {
	if (
		!event.campaignId ||
		!event.signature ||
		!event.wallet ||
		!Number.isSafeInteger(event.instructionIndex) ||
		event.instructionIndex < 0 ||
		!Number.isSafeInteger(event.eventIndex) ||
		event.eventIndex < 0 ||
		!Number.isSafeInteger(event.slot) ||
		event.slot < 0 ||
		!Number.isSafeInteger(event.blockTimeSeconds) ||
		event.blockTimeSeconds < 0
	) {
		throw new TypeError("Invalid Genesis event identity or chain location.");
	}
	const canonical = canonicalJson(event);
	return {
		identity: [
			event.campaignId,
			event.cluster,
			event.signature,
			event.instructionIndex,
			event.eventIndex,
		] as const,
		eventSha256: createHash("sha256").update(canonical).digest("hex"),
	};
}
