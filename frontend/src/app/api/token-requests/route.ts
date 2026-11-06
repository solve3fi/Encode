import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	TOKEN_LOGO_ALLOWED_TYPES,
	TOKEN_LOGO_MAX_BYTES,
	TOKEN_REQUESTS_STORE,
	type TokenRequest,
	type TokenRequestsById,
	tokenRequestAuthMessage,
} from "@/configs/tokenRequests";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { getFaucetConnection } from "@/lib/server/faucetSigner";
import { saveTokenLogo } from "@/lib/server/tokenLogoStorage";
import { verifyWalletSignature } from "@/lib/server/verifyWalletSignature";

export const runtime = "nodejs";

// Public submission: any wallet can request a token be listed. The wallet
// signature here only proves the submitter controls the wallet they claim
// (anti-spam / accountability) — it is NOT an admin check, unlike
// requireAdmin used by the review endpoint below.
export async function POST(request: NextRequest) {
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
	}

	const mintRaw = form.get("mint");
	const symbol = form.get("symbol");
	const name = form.get("name");
	const website = form.get("website");
	const twitter = form.get("twitter");
	const wallet = form.get("wallet");
	const message = form.get("message");
	const signature = form.get("signature");
	const logo = form.get("logo");

	if (
		typeof mintRaw !== "string" ||
		typeof symbol !== "string" ||
		typeof name !== "string" ||
		typeof wallet !== "string" ||
		typeof message !== "string" ||
		typeof signature !== "string" ||
		!(logo instanceof File)
	) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	let mint: PublicKey;
	try {
		mint = new PublicKey(mintRaw);
	} catch {
		return NextResponse.json(
			{ error: "Invalid mint address" },
			{ status: 400 },
		);
	}

	if (message !== tokenRequestAuthMessage(mint.toString())) {
		return NextResponse.json(
			{ error: "Invalid auth message" },
			{ status: 401 },
		);
	}
	if (!verifyWalletSignature(wallet, message, signature)) {
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}

	const extension = TOKEN_LOGO_ALLOWED_TYPES[logo.type];
	if (!extension) {
		return NextResponse.json(
			{ error: "Logo must be PNG, JPG, or WEBP" },
			{ status: 400 },
		);
	}
	if (logo.size > TOKEN_LOGO_MAX_BYTES) {
		return NextResponse.json(
			{ error: `Logo must be under ${TOKEN_LOGO_MAX_BYTES / 1024}KB` },
			{ status: 400 },
		);
	}

	const requests = await readStore<TokenRequestsById>(TOKEN_REQUESTS_STORE, {});
	const existing = requests[mint.toString()];
	if (existing && existing.status !== "rejected") {
		return NextResponse.json(
			{ error: `This mint already has a ${existing.status} request` },
			{ status: 409 },
		);
	}

	let decimals: number;
	try {
		const connection = getFaucetConnection();
		const mintInfo = await getMint(connection, mint);
		decimals = mintInfo.decimals;
	} catch {
		return NextResponse.json(
			{
				error:
					"Couldn't find that mint on devnet. This app currently runs entirely on devnet — if you're trying to list a mainnet token, it won't be readable here until it also exists on devnet.",
			},
			{ status: 400 },
		);
	}

	const logoFile = `${mint.toString()}-${Date.now()}.${extension}`;
	const logoBytes = Buffer.from(await logo.arrayBuffer());
	await saveTokenLogo(logoFile, logoBytes);

	const record: TokenRequest = {
		mint: mint.toString(),
		symbol: symbol.trim().slice(0, 12),
		name: name.trim().slice(0, 64),
		decimals,
		website:
			typeof website === "string" && website.trim()
				? website.trim()
				: undefined,
		twitter:
			typeof twitter === "string" && twitter.trim()
				? twitter.trim()
				: undefined,
		logoFile,
		submittedBy: wallet,
		submittedAt: Date.now(),
		status: "pending",
	};

	requests[mint.toString()] = record;
	await writeStore(TOKEN_REQUESTS_STORE, requests);

	return NextResponse.json(record);
}
