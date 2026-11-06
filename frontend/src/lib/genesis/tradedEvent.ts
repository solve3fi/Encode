import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

/** `Traded` in the redeployed Solve program's `programs/solve/src/events.rs`. */
export type TradedEvent = {
	poolAddress: string;
	aToB: boolean;
	preSqrtPrice: string;
	postSqrtPrice: string;
	inputAmountRaw: string;
	outputAmountRaw: string;
	inputTransferFeeRaw: string;
	outputTransferFeeRaw: string;
	lpFeeRaw: string;
	protocolFeeRaw: string;
};

const DISCRIMINATOR = createHash("sha256")
	.update("event:Traded")
	.digest()
	.subarray(0, 8);
const EVENT_BYTES = 8 + 32 + 1 + 16 + 16 + 8 * 6;

/** Parses one Anchor `Program data:` value; does not attribute a wallet. */
export function decodeTradedEvent(base64: string): TradedEvent {
	const bytes = Buffer.from(base64, "base64");
	if (
		bytes.length !== EVENT_BYTES ||
		!bytes.subarray(0, 8).equals(DISCRIMINATOR)
	) {
		throw new Error("Unsupported or malformed Solve Traded event.");
	}
	const direction = bytes[40];
	if (direction !== 0 && direction !== 1) {
		throw new Error("Invalid Solve trade direction.");
	}
	let offset = 41;
	const readNumber = (width: number) => {
		const value =
			width === 16
				? bytes.readBigUInt64LE(offset) +
					(bytes.readBigUInt64LE(offset + 8) << BigInt(64))
				: bytes.readBigUInt64LE(offset);
		offset += width;
		return value.toString();
	};
	return {
		poolAddress: new PublicKey(bytes.subarray(8, 40)).toString(),
		aToB: direction === 1,
		preSqrtPrice: readNumber(16),
		postSqrtPrice: readNumber(16),
		inputAmountRaw: readNumber(8),
		outputAmountRaw: readNumber(8),
		inputTransferFeeRaw: readNumber(8),
		outputTransferFeeRaw: readNumber(8),
		lpFeeRaw: readNumber(8),
		protocolFeeRaw: readNumber(8),
	};
}
