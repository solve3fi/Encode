import type { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	LAUNCH_LADDER_SAVE_ACTION,
	LAUNCH_LADDER_STORE,
	type SavedLaunchLadder,
	validateLaunchLadderInputs,
} from "@/configs/launchLadder";
import { writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

type AuthBody = {
	wallet?: string;
	message?: string;
	signature?: string;
};

const parseBody = async <T extends AuthBody>(
	request: NextRequest,
): Promise<T | null> => {
	try {
		return (await request.json()) as T;
	} catch {
		return null;
	}
};

// No GET: unlike the other admin stores, the saved ladder is read through
// a signed POST (read/route.ts) so the launch parameters aren't readable
// by anyone who knows the URL before the pool exists.
export async function POST(request: NextRequest) {
	const body = await parseBody<AuthBody & { inputs?: unknown }>(request);
	if (!body) {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { wallet, message, signature } = body;
	if (!wallet || !message || !signature) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}
	const validated = validateLaunchLadderInputs(body.inputs);
	if ("error" in validated) {
		return NextResponse.json({ error: validated.error }, { status: 400 });
	}

	let adminPublicKey: PublicKey;
	try {
		adminPublicKey = requireAdmin(
			{ wallet, message, signature },
			LAUNCH_LADDER_SAVE_ACTION,
			{ inputs: validated.inputs },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const saved: SavedLaunchLadder = {
		inputs: validated.inputs,
		updatedAt: Date.now(),
		updatedBy: adminPublicKey.toString(),
	};
	await writeStore(LAUNCH_LADDER_STORE, saved);
	return NextResponse.json(saved);
}
