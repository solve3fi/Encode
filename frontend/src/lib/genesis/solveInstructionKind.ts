import { createHash } from "node:crypto";

export const SWAP_KINDS = [
	"swap",
	"two_hop_swap",
	"swap_v2",
	"two_hop_swap_v2",
] as const;
export const POSITION_KINDS = [
	"initialize_dynamic_tick_array",
	"initialize_tick_array",
	"open_position",
	"open_position_with_metadata",
	"open_position_with_token_extensions",
	"increase_liquidity",
	"decrease_liquidity",
	"increase_liquidity_v2",
	"decrease_liquidity_v2",
] as const;

export type SwapKind = (typeof SWAP_KINDS)[number];
export type PositionKind = (typeof POSITION_KINDS)[number];
export type SolveInstructionKind =
	| { family: "swap"; kind: SwapKind }
	| { family: "position"; kind: PositionKind };

const BY_DISCRIMINATOR = new Map<string, SolveInstructionKind>();
for (const [family, kinds] of [
	["swap", SWAP_KINDS],
	["position", POSITION_KINDS],
] as const) {
	for (const kind of kinds) {
		const key = createHash("sha256")
			.update(`global:${kind}`)
			.digest("hex")
			.slice(0, 16);
		if (BY_DISCRIMINATOR.has(key))
			throw new Error("Solve instruction discriminator collision.");
		BY_DISCRIMINATOR.set(key, { family, kind } as SolveInstructionKind);
	}
}

export function classifySolveInstruction(
	data: Uint8Array,
): SolveInstructionKind | null {
	if (data.length < 8) return null;
	return (
		BY_DISCRIMINATOR.get(Buffer.from(data.subarray(0, 8)).toString("hex")) ??
		null
	);
}
