import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export type PositionEvent = {
	kind: "position_open" | "liquidity_increase" | "liquidity_decrease";
	poolAddress: string;
	positionAddress: string;
	tickLowerIndex: number;
	tickUpperIndex: number;
	liquidityRaw?: string;
	tokenAAmountRaw?: string;
	tokenBAmountRaw?: string;
	tokenATransferFeeRaw?: string;
	tokenBTransferFeeRaw?: string;
};

const EVENTS = {
	PositionOpened: { kind: "position_open", bytes: 80 },
	LiquidityIncreased: { kind: "liquidity_increase", bytes: 128 },
	LiquidityDecreased: { kind: "liquidity_decrease", bytes: 128 },
} as const;
const BY_DISCRIMINATOR = Object.fromEntries(
	Object.entries(EVENTS).map(([name, spec]) => [
		createHash("sha256").update(`event:${name}`).digest("hex").slice(0, 16),
		spec,
	]),
) as Record<string, (typeof EVENTS)[keyof typeof EVENTS]>;

/** Exact Borsh event layout from the redeployed Solve `events.rs`. */
export function decodePositionEvent(base64: string): PositionEvent {
	const bytes = Buffer.from(base64, "base64");
	const spec = BY_DISCRIMINATOR[bytes.subarray(0, 8).toString("hex")];
	if (!spec || bytes.length !== spec.bytes) {
		throw new Error("Unsupported or malformed Solve position event.");
	}
	const common = {
		kind: spec.kind,
		poolAddress: new PublicKey(bytes.subarray(8, 40)).toBase58(),
		positionAddress: new PublicKey(bytes.subarray(40, 72)).toBase58(),
		tickLowerIndex: bytes.readInt32LE(72),
		tickUpperIndex: bytes.readInt32LE(76),
	};
	if (spec.kind === "position_open") return common;
	const liquidity =
		bytes.readBigUInt64LE(80) + (bytes.readBigUInt64LE(88) << BigInt(64));
	return {
		...common,
		liquidityRaw: liquidity.toString(),
		tokenAAmountRaw: bytes.readBigUInt64LE(96).toString(),
		tokenBAmountRaw: bytes.readBigUInt64LE(104).toString(),
		tokenATransferFeeRaw: bytes.readBigUInt64LE(112).toString(),
		tokenBTransferFeeRaw: bytes.readBigUInt64LE(120).toString(),
	};
}
