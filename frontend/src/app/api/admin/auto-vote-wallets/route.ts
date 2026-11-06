import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { type NextRequest, NextResponse } from "next/server";
import {
	type AdminAutoVoteWallet,
	type AdminAutoVoteWalletsById,
	AUTO_VOTE_WALLET_ADD_ACTION,
	AUTO_VOTE_WALLET_REMOVE_ACTION,
	AUTO_VOTE_WALLET_UPDATE_ACTION,
	AUTO_VOTE_WALLETS_STORE,
	type AutoVotePoolAllocation,
	toPublicAutoVoteWallet,
} from "@/configs/autoVoteWallets";
import { readStore, writeStore } from "@/lib/server/dataStore";
import { requireAdmin } from "@/lib/server/requireAdmin";
import { encryptSecret } from "@/lib/server/secretEncryption";

export const runtime = "nodejs";

// A pasted secret key can be either the standard Solana keypair JSON array
// (64 bytes) or the base58 string most wallet extensions export instead —
// accept both rather than forcing the admin to convert formats by hand.
const parseSecretKey = (raw: string): Keypair => {
	const trimmed = raw.trim();
	try {
		const parsed = JSON.parse(trimmed);
		if (Array.isArray(parsed)) {
			return Keypair.fromSecretKey(Uint8Array.from(parsed));
		}
	} catch {
		// Not JSON — fall through to base58.
	}
	return Keypair.fromSecretKey(bs58.decode(trimmed));
};

const validatePools = (pools: unknown): AutoVotePoolAllocation[] => {
	if (!Array.isArray(pools) || pools.length === 0) {
		throw new Error("At least one pool allocation is required");
	}
	const parsed = pools.map((entry) => {
		if (
			typeof entry !== "object" ||
			entry === null ||
			typeof (entry as { poolAddress?: unknown }).poolAddress !== "string" ||
			typeof (entry as { percent?: unknown }).percent !== "number"
		) {
			throw new Error("Invalid pool allocation entry");
		}
		const { poolAddress, percent } = entry as AutoVotePoolAllocation;
		new PublicKey(poolAddress); // throws on invalid address
		if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
			throw new Error("Pool percentages must be between 0 and 100");
		}
		return { poolAddress, percent: Math.round(percent) };
	});
	const total = parsed.reduce((sum, entry) => sum + entry.percent, 0);
	if (total > 100) {
		throw new Error("Pool percentages add up to more than 100%");
	}
	return parsed;
};

// Public read, same convention as the other admin config routes — the admin
// panel needs this to load before any admin action has been signed. The
// encrypted secret key is always stripped; nothing here can reconstruct it.
export async function GET() {
	const wallets = await readStore<AdminAutoVoteWalletsById>(
		AUTO_VOTE_WALLETS_STORE,
		{},
	);
	const publicWallets = Object.fromEntries(
		Object.entries(wallets).map(([pubkey, wallet]) => [
			pubkey,
			toPublicAutoVoteWallet(wallet),
		]),
	);
	return NextResponse.json(publicWallets);
}

export async function POST(request: NextRequest) {
	let body: {
		wallet?: string;
		message?: string;
		signature?: string;
		secretKey?: string;
		label?: string;
		pools?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { wallet, message, signature, secretKey, label, pools } = body;
	if (!wallet || !message || !signature || !secretKey || !label) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	let pool_allocations: AutoVotePoolAllocation[];
	let keypair: Keypair;
	try {
		pool_allocations = validatePools(pools);
		keypair = parseSecretKey(secretKey);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Invalid input" },
			{ status: 400 },
		);
	}

	let adminPublicKey: PublicKey;
	try {
		adminPublicKey = requireAdmin(
			{ wallet, message, signature },
			AUTO_VOTE_WALLET_ADD_ACTION,
			{ secretKey, label, pools: pool_allocations },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const walletPubkey = keypair.publicKey.toString();
	const wallets = await readStore<AdminAutoVoteWalletsById>(
		AUTO_VOTE_WALLETS_STORE,
		{},
	);
	if (wallets[walletPubkey]) {
		return NextResponse.json(
			{
				error:
					"This wallet is already configured — remove it first to replace its key",
			},
			{ status: 409 },
		);
	}

	const now = Date.now();
	const record: AdminAutoVoteWallet = {
		pubkey: walletPubkey,
		label: label.trim().slice(0, 64),
		encryptedSecretKey: encryptSecret(
			JSON.stringify(Array.from(keypair.secretKey)),
		),
		pools: pool_allocations,
		addedBy: adminPublicKey.toString(),
		addedAt: now,
		updatedAt: now,
	};
	wallets[walletPubkey] = record;
	await writeStore(AUTO_VOTE_WALLETS_STORE, wallets);

	return NextResponse.json({ wallet: toPublicAutoVoteWallet(record) });
}

export async function PATCH(request: NextRequest) {
	let body: {
		wallet?: string;
		message?: string;
		signature?: string;
		pubkey?: string;
		label?: string;
		pools?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { wallet, message, signature, pubkey, label, pools } = body;
	if (!wallet || !message || !signature || !pubkey) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	let pool_allocations: AutoVotePoolAllocation[];
	try {
		pool_allocations = validatePools(pools);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Invalid input" },
			{ status: 400 },
		);
	}

	try {
		requireAdmin(
			{ wallet, message, signature },
			AUTO_VOTE_WALLET_UPDATE_ACTION,
			{ pubkey, label: label ?? "", pools: pool_allocations },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const wallets = await readStore<AdminAutoVoteWalletsById>(
		AUTO_VOTE_WALLETS_STORE,
		{},
	);
	const existing = wallets[pubkey];
	if (!existing) {
		return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
	}

	existing.pools = pool_allocations;
	if (label) existing.label = label.trim().slice(0, 64);
	existing.updatedAt = Date.now();
	await writeStore(AUTO_VOTE_WALLETS_STORE, wallets);

	return NextResponse.json({ wallet: toPublicAutoVoteWallet(existing) });
}

export async function DELETE(request: NextRequest) {
	let body: {
		wallet?: string;
		message?: string;
		signature?: string;
		pubkey?: string;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}

	const { wallet, message, signature, pubkey } = body;
	if (!wallet || !message || !signature || !pubkey) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	try {
		requireAdmin(
			{ wallet, message, signature },
			AUTO_VOTE_WALLET_REMOVE_ACTION,
			{ pubkey },
		);
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Not authorized" },
			{ status: 401 },
		);
	}

	const wallets = await readStore<AdminAutoVoteWalletsById>(
		AUTO_VOTE_WALLETS_STORE,
		{},
	);
	delete wallets[pubkey];
	await writeStore(AUTO_VOTE_WALLETS_STORE, wallets);

	return NextResponse.json({ ok: true });
}
