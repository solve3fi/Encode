import {
	createAssociatedTokenAccountIdempotent,
	mintTo,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { NextResponse, type NextRequest } from "next/server";
import {
	DEVNET_USDC_DECIMALS,
	DEVNET_USDC_MINT,
	FAUCET_CLAIM_AMOUNT,
	FAUCET_COOLDOWN_MS,
} from "@/configs/devnetFaucet";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { getFaucetAuthority, getFaucetConnection } from "@/lib/server/faucetSigner";

export const runtime = "nodejs";

type ClaimRecord = Record<string, number>; // wallet -> last claim unix ms

export async function POST(request: NextRequest) {
	let wallet: string | undefined;
	try {
		const body = await request.json();
		wallet = body.wallet;
	} catch {
		return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
	}

	if (!wallet) {
		return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
	}

	let recipient: PublicKey;
	try {
		recipient = new PublicKey(wallet);
	} catch {
		return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
	}

	const claims = await readStore<ClaimRecord>("faucet-claims", {});
	const lastClaim = claims[recipient.toString()];
	if (lastClaim && Date.now() - lastClaim < FAUCET_COOLDOWN_MS) {
		const retryAfterMs = FAUCET_COOLDOWN_MS - (Date.now() - lastClaim);
		return NextResponse.json(
			{
				error: "Cooldown active",
				retryAfterMs,
			},
			{ status: 429 },
		);
	}

	try {
		const authority = getFaucetAuthority();
		const connection = getFaucetConnection();

		const recipientAta = await createAssociatedTokenAccountIdempotent(
			connection,
			authority,
			DEVNET_USDC_MINT,
			recipient,
		);

		const signature = await mintTo(
			connection,
			authority,
			DEVNET_USDC_MINT,
			recipientAta,
			authority,
			FAUCET_CLAIM_AMOUNT * 10 ** DEVNET_USDC_DECIMALS,
		);

		claims[recipient.toString()] = Date.now();
		await writeStore("faucet-claims", claims);

		return NextResponse.json({ signature, amount: FAUCET_CLAIM_AMOUNT });
	} catch (error) {
		console.error("faucet claim failed:", error);
		return NextResponse.json({ error: "Claim failed" }, { status: 500 });
	}
}

// Lets the claim page check remaining cooldown before showing the button.
export async function GET(request: NextRequest) {
	const wallet = request.nextUrl.searchParams.get("wallet");
	if (!wallet) {
		return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
	}

	let recipient: PublicKey;
	try {
		recipient = new PublicKey(wallet);
	} catch {
		return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
	}

	const claims = await readStore<ClaimRecord>("faucet-claims", {});
	const lastClaim = claims[recipient.toString()];
	const retryAfterMs = lastClaim
		? Math.max(FAUCET_COOLDOWN_MS - (Date.now() - lastClaim), 0)
		: 0;

	return NextResponse.json({ retryAfterMs, claimAmount: FAUCET_CLAIM_AMOUNT });
}
