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
import { AIRDROP_TOKEN_DECIMALS, AIRDROP_TOKEN_MINT } from "@/configs/airdrop";
import type { AirdropAllocations } from "@/configs/airdropTypes";
import { buildAirdropClaimMessage } from "@/lib/airdropMessage";
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
import { recoverEthSigner } from "@/lib/server/verifyEthSignature";
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

const amountRawFor = (allocation: AirdropAllocations[string]): bigint =>
	allocation.amountRaw
		? BigInt(allocation.amountRaw)
		: BigInt(Math.round(allocation.amount * 10 ** AIRDROP_TOKEN_DECIMALS));

// Comfortably longer than a Solana blockhash's ~60-90s validity window, so
// by the time a reservation expires, any transaction issued under it has
// already expired too and can no longer be submitted — see the comment on
// AirdropAllocation.reservedLockAddress for why this exists.
const RESERVATION_TTL_MS = 5 * 60_000;

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

	let recipient: PublicKey;
	try {
		recipient = new PublicKey(solanaAddress);
	} catch {
		return NextResponse.json(
			{ error: "Invalid Solana address" },
			{ status: 400 },
		);
	}

	const key = ethAddress.toLowerCase();
	const allocations = await readStore<AirdropAllocations>(
		"airdrop-allocations",
		{},
	);
	let allocation = allocations[key];

	if (!allocation) {
		return NextResponse.json(
			{ error: "Not eligible for the airdrop" },
			{ status: 403 },
		);
	}
	if (isUnprovenClaim(allocation)) {
		// Marked claimed by the old stale-reservation check without any transaction: re-prove it on chain and
		// reopen it when the reserved lock is not this claimant's (the claim never landed).
		try {
			allocation = await reopenUnprovenClaim(
				allocation,
				allocation.reservedRecipient ? new PublicKey(allocation.reservedRecipient) : allocation.solanaAddress ? new PublicKey(allocation.solanaAddress) : recipient,
				amountRawFor(allocation),
			);
		} catch (error) {
			console.error("unproven claim check failed:", error);
			return NextResponse.json(
				{ error: "Could not verify the previous claim attempt — try again shortly" },
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
		// Reservation expired without a call to /finalize. Resolve against
		// chain reality rather than just reopening the allocation: if the
		// previously-issued transaction actually landed, self-heal the ledger
		// instead of letting a fresh claim mint a second full allocation.
		// Existence of the reserved lock is not proof: its id is just the next one at build time, so any other
		// create_lock (e.g. after this claimant's send failed for lack of SOL) takes it. Require the claimant's
		// lock with exactly this allocation, and refuse on an RPC error rather than issue a second claim.
		let reservedClaimDone: boolean;
		try {
			reservedClaimDone = await reservedClaimLanded(
				getVesolveServerProgram(getFaucetConnection(), getFaucetAuthority()),
				new PublicKey(allocation.reservedLockAddress),
				allocation.reservedRecipient
					? new PublicKey(allocation.reservedRecipient)
					: recipient,
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
				solanaAddress:
					allocation.reservedRecipient ??
					allocation.solanaAddress ??
					recipient.toString(),
				minted: true,
				locked: true,
				lockedAt: Date.now(),
			};
			await writeStore("airdrop-allocations", allocations);
			return NextResponse.json({ error: "Already claimed" }, { status: 409 });
		}
		// Abandoned — nobody ever submitted the reserved transaction, and its
		// blockhash has long since expired. Safe to fall through and reserve
		// a fresh one below.
	}

	const expectedMessage = buildAirdropClaimMessage(
		allocation.amount,
		recipient.toString(),
	);
	const recovered = recoverEthSigner(expectedMessage, signature);
	if (!recovered || recovered.toLowerCase() !== key) {
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}

	if (isClaimInFlight(key)) {
		return NextResponse.json(
			{
				error:
					"A claim for this address is already being built — try again shortly",
			},
			{ status: 409 },
		);
	}
	markClaimInFlight(key);

	try {
		const authority = getFaucetAuthority();
		const connection = getFaucetConnection();
		const program = getVesolveServerProgram(connection, authority);
		const amountRaw = amountRawFor(allocation);

		const authorityAta = getAssociatedTokenAddressSync(
			AIRDROP_TOKEN_MINT,
			authority.publicKey,
		);
		const recipientAta = getAssociatedTokenAddressSync(
			AIRDROP_TOKEN_MINT,
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
			AIRDROP_TOKEN_MINT,
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
				tokenMint: AIRDROP_TOKEN_MINT,
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
				AIRDROP_TOKEN_MINT,
			),
			createTransferCheckedInstruction(
				authorityAta,
				AIRDROP_TOKEN_MINT,
				recipientAta,
				authority.publicKey,
				amountRaw,
				AIRDROP_TOKEN_DECIMALS,
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

		// Written only now that a real transaction exists for this lockAddress
		// — not earlier, so a transient build failure above never leaves a
		// reservation with nothing behind it (which would 409-lock a
		// legitimate retry for the full TTL). This is what makes a second
		// claim call for the same allocation, issued before /finalize ever
		// runs, get rejected instead of minting a duplicate allocation.
		allocations[key] = {
			...allocation,
			reservedLockAddress: lockAddress.toString(),
			reservedRecipient: recipient.toString(),
			reservedAt: Date.now(),
		};
		await writeStore("airdrop-allocations", allocations);

		return NextResponse.json({
			transaction: serialized,
			amount: allocation.amount,
			lockAddress: lockAddress.toString(),
			veMint: veMint.toString(),
		});
	} catch (error) {
		console.error("airdrop claim build failed:", error);
		clearClaimInFlight(key);
		return NextResponse.json(
			{ error: "Could not build claim transaction" },
			{ status: 500 },
		);
	}
}
