import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import type { AirdropAllocations } from "@/configs/airdropTypes";
import { clearClaimInFlight } from "@/lib/server/airdropClaimGuard";
import { readStore, writeStore } from "@/lib/server/dataStore";
import {
	getFaucetAuthority,
	getFaucetConnection,
} from "@/lib/server/faucetSigner";

export const runtime = "nodejs";

/**
 * Confirms a claim's combined transfer+create_lock transaction (built by
 * POST /api/airdrop/claim) actually landed, then marks the allocation both
 * minted and locked together. The transaction is proof enough on its own:
 * the faucet authority's signature can only appear on a transaction this
 * server built, and every transaction this server builds for a claim always
 * pairs the transfer with the matching create_lock instruction for the same
 * amount — so "confirmed, succeeded, signed by both the authority and the
 * claimant" is sufficient, without needing to re-decode instructions.
 */
export async function POST(request: NextRequest) {
	let ethAddress: string | undefined;
	let solanaAddress: string | undefined;
	let signature: string | undefined;
	try {
		const body = await request.json();
		ethAddress = body.ethAddress;
		solanaAddress = body.solanaAddress;
		signature = body.signature;
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	if (!ethAddress || !solanaAddress || !signature) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	const key = ethAddress.toLowerCase();
	let claimant: PublicKey;
	try {
		claimant = new PublicKey(solanaAddress);
	} catch {
		return NextResponse.json(
			{ error: "Invalid Solana address" },
			{ status: 400 },
		);
	}

	const allocations = await readStore<AirdropAllocations>(
		"airdrop-allocations",
		{},
	);
	const allocation = allocations[key];
	if (!allocation) {
		return NextResponse.json(
			{ error: "Not eligible for the airdrop" },
			{ status: 403 },
		);
	}
	if (allocation.minted || allocation.locked) {
		// Idempotent: a retried finalize call for an already-completed claim
		// is a success, not an error.
		return NextResponse.json({
			signature: allocation.mintedSignature,
			amount: allocation.amount,
		});
	}

	// Confirmed failure here is stronger proof than the reservation TTL can
	// offer on its own, so don't make a legitimate retry wait it out — clear
	// reservedLockAddress/reservedAt (written by POST /api/airdrop/claim)
	// the moment we know the issued transaction is dead.
	const clearReservation = async () => {
		const current = await readStore<AirdropAllocations>(
			"airdrop-allocations",
			{},
		);
		if (current[key]?.reservedLockAddress || current[key]?.reservedAt) {
			current[key] = {
				...current[key],
				reservedLockAddress: undefined,
				reservedRecipient: undefined,
				reservedAt: undefined,
			};
			await writeStore("airdrop-allocations", current);
		}
	};

	const connection = getFaucetConnection();
	const authority = getFaucetAuthority();

	const tx = await connection.getTransaction(signature, {
		commitment: "confirmed",
		maxSupportedTransactionVersion: 0,
	});
	if (!tx || tx.meta?.err) {
		// Clear the in-flight guard on a genuine failure so the claimant can
		// retry immediately, rather than waiting out the TTL.
		clearClaimInFlight(key);
		await clearReservation();
		return NextResponse.json(
			{ error: "Transaction not found or failed" },
			{ status: 400 },
		);
	}

	const signerKeys = tx.transaction.message.staticAccountKeys ?? [];
	const numRequiredSignatures =
		tx.transaction.message.header.numRequiredSignatures;
	const requiredSigners = signerKeys.slice(0, numRequiredSignatures);
	const signedByAuthority = requiredSigners.some((k) =>
		k.equals(authority.publicKey),
	);
	const signedByClaimant = requiredSigners.some((k) => k.equals(claimant));

	if (!signedByAuthority || !signedByClaimant) {
		clearClaimInFlight(key);
		await clearReservation();
		return NextResponse.json(
			{ error: "Transaction wasn't the expected claim+lock transaction" },
			{ status: 400 },
		);
	}

	allocations[key] = {
		...allocation,
		solanaAddress: claimant.toString(),
		minted: true,
		mintedSignature: signature,
		mintedAt: Date.now(),
		locked: true,
		lockedSignature: signature,
		lockedAt: Date.now(),
	};
	await writeStore("airdrop-allocations", allocations);
	clearClaimInFlight(key);

	return NextResponse.json({ signature, amount: allocation.amount });
}
