import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import type { PresaleAllocations } from "@/configs/presaleTypes";
import { clearClaimInFlight } from "@/lib/server/airdropClaimGuard";
import { readStore, writeStore } from "@/lib/server/dataStore";
import {
	getFaucetAuthority,
	getFaucetConnection,
} from "@/lib/server/faucetSigner";
import {
	claimFlightKey,
	claimStoreFor,
	parsePresaleRound,
} from "@/lib/server/presaleClaimRound";

export const runtime = "nodejs";

/**
 * Confirms a presale claim's combined transfer+create_lock transaction
 * (built by POST /api/presale/claim) actually landed, then marks the
 * allocation both minted and locked together. Same reasoning as
 * /api/airdrop/finalize: the faucet authority's signature can only appear
 * on a transaction this server built, and every transaction this server
 * builds for a claim always pairs the transfer with the matching
 * create_lock instruction for the same amount.
 */
export async function POST(request: NextRequest) {
	let solanaAddress: string | undefined;
	let signature: string | undefined;
	let roundField: unknown;
	try {
		const body = await request.json();
		roundField = body.round;
		solanaAddress = body.solanaAddress;
		signature = body.signature;
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	if (!solanaAddress || !signature) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	let claimant: PublicKey;
	try {
		claimant = new PublicKey(solanaAddress);
	} catch {
		return NextResponse.json(
			{ error: "Invalid Solana address" },
			{ status: 400 },
		);
	}

	const round = parsePresaleRound(roundField);
	if (round === null)
		return NextResponse.json(
			{ error: "Invalid presale round" },
			{ status: 400 },
		);
	const store = claimStoreFor(round);
	const key = claimant.toString();
	const flightKey = claimFlightKey(round, key);
	const allocations = await readStore<PresaleAllocations>(store, {});
	const allocation = allocations[key];
	if (!allocation) {
		return NextResponse.json(
			{ error: "Not eligible for the presale claim" },
			{ status: 403 },
		);
	}
	if (allocation.minted || allocation.locked) {
		return NextResponse.json({
			signature: allocation.mintedSignature,
			veSolv3Amount: allocation.veSolv3Amount,
		});
	}

	const clearReservation = async () => {
		const current = await readStore<PresaleAllocations>(store, {});
		if (current[key]?.reservedLockAddress || current[key]?.reservedAt) {
			current[key] = {
				...current[key],
				reservedLockAddress: undefined,
				reservedAt: undefined,
			};
			await writeStore(store, current);
		}
	};

	const connection = getFaucetConnection();
	const authority = getFaucetAuthority();

	const tx = await connection.getTransaction(signature, {
		commitment: "confirmed",
		maxSupportedTransactionVersion: 0,
	});
	if (!tx || tx.meta?.err) {
		clearClaimInFlight(flightKey);
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
		clearClaimInFlight(flightKey);
		await clearReservation();
		return NextResponse.json(
			{ error: "Transaction wasn't the expected claim+lock transaction" },
			{ status: 400 },
		);
	}

	allocations[key] = {
		...allocation,
		minted: true,
		mintedSignature: signature,
		mintedAt: Date.now(),
		locked: true,
		lockedSignature: signature,
		lockedAt: Date.now(),
	};
	await writeStore(store, allocations);
	clearClaimInFlight(flightKey);

	return NextResponse.json({
		signature,
		veSolv3Amount: allocation.veSolv3Amount,
	});
}
