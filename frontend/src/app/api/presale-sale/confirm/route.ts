import { type NextRequest, NextResponse } from "next/server";
import { presaleMainnetConnection } from "@/lib/server/presaleMainnet";
import {
	type ParsedPaymentTx,
	verifyPresalePayment,
} from "@/lib/server/presalePayment";
import {
	appendSaleLog,
	quoteVeSolv3Raw,
	withSaleLedger,
} from "@/lib/server/presaleSaleStore";

export const runtime = "nodejs";

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/**
 * Records a purchase once its mainnet payment is verified against the quote (verifyPresalePayment). Idempotent: the
 * same payment confirms to the same purchase; a payment can never be counted twice and a quote is spent once.
 */
export async function POST(request: NextRequest) {
	let body: { quoteId?: unknown; signature?: unknown };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}
	const { quoteId, signature } = body;
	if (typeof quoteId !== "string" || !/^[0-9a-f]{24}$/.test(quoteId))
		return NextResponse.json({ error: "Invalid quote" }, { status: 400 });
	if (typeof signature !== "string" || !SIGNATURE.test(signature))
		return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

	const quote = await withSaleLedger(
		async (state) => state.quotes[quoteId] ?? null,
	);
	if (!quote)
		return NextResponse.json({ error: "Unknown quote" }, { status: 404 });

	let tx: ParsedPaymentTx;
	try {
		tx = (await presaleMainnetConnection().getParsedTransaction(signature, {
			commitment: "confirmed",
			maxSupportedTransactionVersion: 0,
		})) as unknown as ParsedPaymentTx;
	} catch {
		return NextResponse.json(
			{ error: "Could not read the payment, try again" },
			{ status: 503 },
		);
	}
	const check = verifyPresalePayment(tx, quote);
	if (!check.ok) {
		// Not found yet is retryable; anything else is a mismatch.
		const pending = !tx;
		if (!pending)
			await appendSaleLog({
				event: "payment_rejected",
				quoteId,
				signature,
				reason: check.reason,
			});
		return NextResponse.json(
			{ error: check.reason, retry: pending },
			{ status: pending ? 202 : 422 },
		);
	}

	const outcome = await withSaleLedger(async (state, save) => {
		const existing = state.purchases[signature];
		if (existing)
			return existing.quoteId === quoteId
				? { purchase: existing, created: false }
				: { error: "This payment was already used" };
		const q = state.quotes[quoteId];
		if (!q) return { error: "Unknown quote" };
		if (q.confirmedSignature && q.confirmedSignature !== signature)
			return { error: "This quote was already paid" };
		const purchase = {
			signature,
			quoteId,
			wallet: q.wallet,
			token: q.token,
			usd: q.usd,
			veSolv3Raw: quoteVeSolv3Raw(q.usd).toString(),
			amountRaw: q.amountRaw,
			solPriceUsd: q.solPriceUsd,
			at: new Date().toISOString(),
		};
		state.purchases[signature] = purchase;
		q.confirmedSignature = signature;
		await save(state);
		return { purchase, created: true };
	});
	if ("error" in outcome)
		return NextResponse.json({ error: outcome.error }, { status: 409 });
	if (outcome.created)
		await appendSaleLog({ event: "purchase", ...outcome.purchase });
	return NextResponse.json({ purchase: outcome.purchase });
}
