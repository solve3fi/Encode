import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	ACCELERATOR_CONFIG_SET_ACTION,
	ACCELERATOR_CONFIG_STORE,
	type AcceleratorConfig,
	acceleratorConfigPayload,
} from "@/configs/acceleratorProgram";
import { AcceleratorLockError, parseAcceleratorLockId, validateAcceleratorLockSelection } from "@/lib/server/acceleratorLock";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";

export const runtime = "nodejs";

export async function GET() {
	const config = await readStore<AcceleratorConfig>(
		ACCELERATOR_CONFIG_STORE,
		{},
	);
	return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
	let body: {
		wallet?: string;
		message?: string;
		signature?: string;
		acceleratorWalletPubkey?: string;
		automatic?: boolean;
		veTokenId?: string;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { wallet, message, signature, acceleratorWalletPubkey, automatic, veTokenId } = body;
	if (!wallet || !message || !signature) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}
	if (acceleratorWalletPubkey) {
		try {
			new PublicKey(acceleratorWalletPubkey);
		} catch {
			return NextResponse.json(
				{ error: "Invalid wallet address" },
				{ status: 400 },
			);
		}
	}
	if (veTokenId !== undefined) {
		try { parseAcceleratorLockId(veTokenId); }
		catch { return NextResponse.json({ error: "Choose a valid lock ID." }, { status: 400 }); }
	}

	let adminPublicKey: PublicKey;
	try {
		adminPublicKey = requireAdmin(
			{ wallet, message, signature },
			ACCELERATOR_CONFIG_SET_ACTION,
			acceleratorConfigPayload({ acceleratorWalletPubkey, automatic, veTokenId }),
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	// Changing one setting must not reset the other.
	let existing = await readStore<AcceleratorConfig>(ACCELERATOR_CONFIG_STORE, {});
	if (veTokenId !== undefined) {
		const selectedWallet = acceleratorWalletPubkey || existing.acceleratorWalletPubkey;
		if (!selectedWallet) return NextResponse.json({ error: "Choose an Accelerator wallet first." }, { status: 400 });
		try {
			await validateAcceleratorLockSelection({ veTokenId, wallet: selectedWallet,
				previousLockId: selectedWallet === existing.acceleratorWalletPubkey ? existing.veTokenId : undefined,
				activationEpoch: existing.activationEpoch });
		} catch (error) {
			return NextResponse.json({ error: error instanceof AcceleratorLockError ? error.message : "Unable to verify the lock on Devnet. Try again." }, { status: error instanceof AcceleratorLockError ? 400 : 503 });
		}
		const latest = await readStore<AcceleratorConfig>(ACCELERATOR_CONFIG_STORE, {});
		if (latest.acceleratorWalletPubkey !== existing.acceleratorWalletPubkey || latest.veTokenId !== existing.veTokenId || latest.activationEpoch !== existing.activationEpoch)
			return NextResponse.json({ error: "Accelerator settings changed. Reload and try again." }, { status: 409 });
		existing = latest;
	}
	const config: AcceleratorConfig = {
		...existing,
		acceleratorWalletPubkey: acceleratorWalletPubkey || existing.acceleratorWalletPubkey,
		automatic: typeof automatic === "boolean" ? automatic : existing.automatic,
		veTokenId: veTokenId ?? existing.veTokenId,
		updatedBy: adminPublicKey.toString(),
		updatedAt: Date.now(),
	};
	await writeStore(ACCELERATOR_CONFIG_STORE, config);

	return NextResponse.json({ config });
}
