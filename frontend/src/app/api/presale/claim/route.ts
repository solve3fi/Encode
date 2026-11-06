import { BN } from "@coral-xyz/anchor";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountIdempotentInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
	PublicKey,
	SYSVAR_RENT_PUBKEY,
	SystemProgram,
	Transaction,
} from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import { PRESALE_TOKEN_DECIMALS, PRESALE_TOKEN_MINT } from "@/configs/presale";
import type { PresaleAllocations } from "@/configs/presaleTypes";
import {
	clearClaimInFlight,
	isClaimInFlight,
	markClaimInFlight,
} from "@/lib/server/airdropClaimGuard";
import {
	isUnprovenClaim,
	reopenUnprovenClaim,
	reservedClaimLanded,
} from "@/lib/server/claimReservation";
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
import {
	getLockPDA,
	getMetadataPDA,
	getProtocolPDA,
	getVeMintPDA,
	getVesolveServerProgram,
	METADATA_PROGRAM_ID,
	vesolveProtocolAccount,
} from "@/lib/server/vesolveServerProgram";

export const runtime = "nodejs";

const amountRawFor = (allocation: PresaleAllocations[string]): bigint =>
	allocation.amountRaw
		? BigInt(allocation.amountRaw)
		: BigInt(
				Math.round(allocation.veSolv3Amount * 10 ** PRESALE_TOKEN_DECIMALS),
			);

// Same rationale as the airdrop's identical constant: comfortably longer
// than a Solana blockhash's ~60-90s validity window.
const RESERVATION_TTL_MS = 5 * 60_000;

export async function POST(request: NextRequest) {
	let solanaAddress: string | undefined;
	let roundField: unknown;
	try {
		const body = await request.json();
		solanaAddress = body.solanaAddress;
		roundField = body.round;
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	if (!solanaAddress) {
		return NextResponse.json(
			{ error: "Missing solanaAddress" },
			{ status: 400 },
		);
	}

	let recipient: PublicKey;
	try {
		recipient = new PublicKey(solanaAddress);
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
	const key = recipient.toString();
	const flightKey = claimFlightKey(round, key);
	const allocations = await readStore<PresaleAllocations>(store, {});
	let allocation = allocations[key];

	if (!allocation) {
		return NextResponse.json(
			{ error: "Not eligible for the presale claim" },
			{ status: 403 },
		);
	}
	if (isUnprovenClaim(allocation)) {
		// Marked claimed by the old stale-reservation check without any transaction: re-prove it on chain and
		// reopen it when the reserved lock is not this claimant's (the claim never landed).
		try {
			allocation = await reopenUnprovenClaim(
				allocation,
				recipient,
				amountRawFor(allocation),
			);
		} catch (error) {
			console.error("unproven claim check failed:", error);
			return NextResponse.json(
				{
					error:
						"Could not verify the previous claim attempt — try again shortly",
				},
				{ status: 503 },
			);
		}
	}
	if (allocation.minted || allocation.locked) {
		return NextResponse.json({ error: "Already claimed" }, { status: 409 });
	}

	if (allocation.reservedLockAddress) {
		const reservedAt = allocation.reservedAt ?? 0;
		if (Date.now() - reservedAt < RESERVATION_TTL_MS) {
			return NextResponse.json(
				{
					error:
						"A claim for this address is already being built — try again shortly",
				},
				{ status: 409 },
			);
		}
		// Existence of the reserved lock is not proof: its id is just the next one at build time, so any other
		// create_lock (e.g. after this claimant's send failed for lack of SOL) takes it. Require the claimant's
		// lock with exactly this allocation, and refuse on an RPC error rather than issue a second claim.
		let reservedClaimDone: boolean;
		try {
			reservedClaimDone = await reservedClaimLanded(
				getVesolveServerProgram(getFaucetConnection(), getFaucetAuthority()),
				new PublicKey(allocation.reservedLockAddress),
				recipient,
				amountRawFor(allocation),
			);
		} catch (error) {
			console.error("claim reservation check failed:", error);
			return NextResponse.json(
				{
					error:
						"Could not verify the previous claim attempt — try again shortly",
				},
				{ status: 503 },
			);
		}
		if (reservedClaimDone) {
			allocations[key] = {
				...allocation,
				minted: true,
				locked: true,
				lockedAt: Date.now(),
			};
			await writeStore(store, allocations);
			return NextResponse.json({ error: "Already claimed" }, { status: 409 });
		}
	}

	if (isClaimInFlight(flightKey)) {
		return NextResponse.json(
			{
				error:
					"A claim for this address is already being built — try again shortly",
			},
			{ status: 409 },
		);
	}
	markClaimInFlight(flightKey);

	try {
		const authority = getFaucetAuthority();
		const connection = getFaucetConnection();
		const program = getVesolveServerProgram(connection, authority);
		const amountRaw = amountRawFor(allocation);

		const authorityAta = getAssociatedTokenAddressSync(
			PRESALE_TOKEN_MINT,
			authority.publicKey,
		);
		const recipientAta = getAssociatedTokenAddressSync(
			PRESALE_TOKEN_MINT,
			recipient,
		);

		const [protocolAddress] = getProtocolPDA();
		const protocol =
			await vesolveProtocolAccount(program).fetch(protocolAddress);
		const nextId = protocol.nextNftTokenId;
		const [lockAddress] = getLockPDA(BigInt(nextId.toString()));
		const [veMint] = getVeMintPDA(BigInt(nextId.toString()));
		const veTokenAccount = getAssociatedTokenAddressSync(veMint, recipient);
		const [metadata] = getMetadataPDA(veMint);
		const protocolTokenAccount = getAssociatedTokenAddressSync(
			PRESALE_TOKEN_MINT,
			protocolAddress,
			true,
		);

		const createLockIx = await program.methods
			.createLock(
				new BN(amountRaw.toString()),
				new BN(Math.floor(Date.now() / 1000)),
			)
			.accounts({
				user: recipient,
				protocol: protocolAddress,
				lock: lockAddress,
				userTokenAccount: recipientAta,
				tokenMint: PRESALE_TOKEN_MINT,
				protocolTokenAccount,
				veMint,
				veTokenAccount,
				metadata,
				systemProgram: SystemProgram.programId,
				tokenProgram: TOKEN_PROGRAM_ID,
				associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
				metadataProgram: METADATA_PROGRAM_ID,
				rent: SYSVAR_RENT_PUBKEY,
			})
			.instruction();

		const transaction = new Transaction().add(
			createAssociatedTokenAccountIdempotentInstruction(
				authority.publicKey,
				recipientAta,
				recipient,
				PRESALE_TOKEN_MINT,
			),
			createTransferCheckedInstruction(
				authorityAta,
				PRESALE_TOKEN_MINT,
				recipientAta,
				authority.publicKey,
				amountRaw,
				PRESALE_TOKEN_DECIMALS,
			),
			createLockIx,
		);
		transaction.feePayer = recipient;
		transaction.recentBlockhash = (
			await connection.getLatestBlockhash()
		).blockhash;
		transaction.partialSign(authority);

		const serialized = transaction
			.serialize({ requireAllSignatures: false, verifySignatures: false })
			.toString("base64");

		// Written only now that a real transaction exists for this lockAddress —
		// see the identical comment in airdrop/claim/route.ts for why.
		allocations[key] = {
			...allocation,
			reservedLockAddress: lockAddress.toString(),
			reservedAt: Date.now(),
		};
		await writeStore(store, allocations);

		return NextResponse.json({
			transaction: serialized,
			veSolv3Amount: allocation.veSolv3Amount,
			lockAddress: lockAddress.toString(),
			veMint: veMint.toString(),
		});
	} catch (error) {
		console.error("presale claim build failed:", error);
		clearClaimInFlight(flightKey);
		return NextResponse.json(
			{ error: "Could not build claim transaction" },
			{ status: 500 },
		);
	}
}
