import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { type NextRequest, NextResponse } from "next/server";
import {
	MAINNET_USDC_MINT,
	SALE_TOKENS,
	type SaleQuote,
	type SaleToken,
} from "@/configs/presaleSale";
import {
	allowQuote,
	clientKeyOf,
	presaleMainnetConnection,
} from "@/lib/server/presaleMainnet";
import {
	appendSaleLog,
	newQuoteId,
	quoteExpiry,
	quoteMemo,
	quoteRefusal,
	quoteVeSolv3Raw,
	withSaleLedger,
} from "@/lib/server/presaleSaleStore";
import { lamportsForUsd, solUsdPrice } from "@/lib/server/solUsdPrice";

export const runtime = "nodejs";

/**
 * A quote for buying veSOLV3 with USDC or SOL: the exact amount to send, where to send it, and a memo that ties the
 * payment to this quote. It holds its share of the cap and of the wallet's limit until it expires (QUOTE_TTL_MS).
 */
export async function POST(request: NextRequest) {
	let body: { wallet?: unknown; token?: unknown; usd?: unknown };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}
	const { wallet, token, usd } = body;
	if (typeof wallet !== "string")
		return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
	try {
		new PublicKey(wallet);
	} catch {
		return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
	}
	if (!SALE_TOKENS.includes(token as SaleToken))
		return NextResponse.json(
			{ error: "Pay with USDC or SOL" },
			{ status: 400 },
		);
	if (typeof usd !== "number" || !Number.isSafeInteger(usd) || usd <= 0)
		return NextResponse.json(
			{ error: "Enter a whole number of dollars" },
			{ status: 400 },
		);
	if (!allowQuote(clientKeyOf(request.headers)))
		return NextResponse.json(
			{ error: "Too many quotes, wait a few minutes" },
			{ status: 429 },
		);

	// Network work happens outside the ledger lock; limits are re-checked inside it.
	let solPriceUsd: number | null = null;
	let amountRaw: bigint;
	if (token === "SOL") {
		try {
			solPriceUsd = await solUsdPrice();
		} catch (error) {
			return NextResponse.json(
				{
					error:
						error instanceof Error ? error.message : "SOL price unavailable",
				},
				{ status: 503 },
			);
		}
		amountRaw = lamportsForUsd(usd, solPriceUsd);
	} else {
		amountRaw = BigInt(usd) * BigInt(1_000_000);
	}

	try {
		const quote = await withSaleLedger(async (state, save) => {
			const now = Date.now();
			const refusal = quoteRefusal(state, now, wallet, usd);
			if (refusal) throw Object.assign(new Error(refusal), { status: 409 });
			const treasury = (state.config as NonNullable<typeof state.config>)
				.treasury;
			let destination = treasury;
			if (token === "USDC") {
				destination = getAssociatedTokenAddressSync(
					new PublicKey(MAINNET_USDC_MINT),
					new PublicKey(treasury),
					true,
				).toBase58();
				const account = await presaleMainnetConnection().getAccountInfo(
					new PublicKey(destination),
				);
				if (!account)
					throw Object.assign(
						new Error(
							"USDC payments are not ready yet, pay with SOL or try later",
						),
						{ status: 503 },
					);
			}
			const id = newQuoteId();
			const q: SaleQuote = {
				id,
				wallet,
				token: token as SaleToken,
				usd,
				veSolv3: Number(quoteVeSolv3Raw(usd) / BigInt(1_000_000)) / 1000,
				amountRaw: amountRaw.toString(),
				solPriceUsd,
				treasury,
				destination,
				memo: quoteMemo(id),
				createdAt: new Date(now).toISOString(),
				expiresAt: quoteExpiry(now),
			};
			// Expired, unconfirmed quotes are dropped so the file stays small.
			for (const [key, old] of Object.entries(state.quotes))
				if (
					!old.confirmedSignature &&
					Date.parse(old.expiresAt) < now - 24 * 3_600_000
				)
					delete state.quotes[key];
			state.quotes[id] = q;
			await save(state);
			return q;
		});
		await appendSaleLog({
			event: "quote",
			id: quote.id,
			wallet,
			token,
			usd,
			amountRaw: quote.amountRaw,
			solPriceUsd,
		});
		return NextResponse.json(quote);
	} catch (error) {
		const status = (error as { status?: number }).status ?? 500;
		return NextResponse.json(
			{
				error:
					status === 500
						? "Could not create a quote"
						: (error as Error).message,
			},
			{ status },
		);
	}
}
