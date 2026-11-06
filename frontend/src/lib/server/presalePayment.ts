import "server-only";
import {
	MAINNET_USDC_MINT,
	PAYMENT_GRACE_MS,
	type SaleQuote,
} from "@/configs/presaleSale";

/**
 * Checks that a mainnet transaction is exactly the payment a presale quote asked for. Pure (works on the parsed
 * transaction the RPC returns), so it is tested without a network. All of these must hold:
 *   - the transaction succeeded, and the buyer's wallet signed it and paid its fee;
 *   - it carries the quote's memo, once;
 *   - it has exactly one top-level transfer of the quoted amount to the quoted destination: a System transfer from the
 *     buyer to the Treasury wallet (SOL), or an SPL transferChecked of mainnet USDC signed by the buyer into the
 *     Treasury's USDC account;
 *   - the destination's balance really rose by at least that amount;
 *   - it landed between the quote's creation and its expiry plus a short grace.
 */

type ParsedIx = {
	program?: string;
	programId?: { toString(): string } | string;
	parsed?: unknown;
};
type AccountKey = { pubkey: { toString(): string } | string; signer?: boolean };
type TokenBalance = {
	accountIndex: number;
	mint: string;
	uiTokenAmount: { amount: string };
};
export type ParsedPaymentTx = {
	blockTime?: number | null;
	meta: {
		err: unknown;
		preBalances: number[];
		postBalances: number[];
		preTokenBalances?: TokenBalance[] | null;
		postTokenBalances?: TokenBalance[] | null;
	} | null;
	transaction: {
		message: { accountKeys: AccountKey[]; instructions: ParsedIx[] };
	};
} | null;

export type PaymentCheck = { ok: true } | { ok: false; reason: string };

const str = (value: { toString(): string } | string | undefined) =>
	value === undefined ? "" : value.toString();
const fail = (reason: string): PaymentCheck => ({ ok: false, reason });

export function verifyPresalePayment(
	tx: ParsedPaymentTx,
	quote: SaleQuote,
): PaymentCheck {
	if (!tx?.meta) return fail("Payment transaction not found yet");
	if (tx.meta.err !== null && tx.meta.err !== undefined)
		return fail("The payment transaction failed");
	const keys = tx.transaction.message.accountKeys.map((k) => ({
		key: str(k.pubkey),
		signer: Boolean(k.signer),
	}));
	if (keys[0]?.key !== quote.wallet || !keys[0].signer)
		return fail("The payment was not paid by the quoted wallet");

	// Fail closed on an unreadable quote date too (a NaN comparison would otherwise pass).
	const createdAt = Date.parse(quote.createdAt);
	const expiresAt = Date.parse(quote.expiresAt);
	const at = (tx.blockTime ?? 0) * 1000;
	if (
		!Number.isFinite(createdAt) ||
		!Number.isFinite(expiresAt) ||
		!tx.blockTime ||
		at < createdAt - 60_000 ||
		at > expiresAt + PAYMENT_GRACE_MS
	)
		return fail("The payment landed outside the quote window");

	const instructions = tx.transaction.message.instructions;
	const memos = instructions.filter((ix) => ix.program === "spl-memo");
	if (memos.length !== 1 || memos[0].parsed !== quote.memo)
		return fail("The payment does not carry this quote's memo");

	const amount = BigInt(quote.amountRaw);
	const index = (account: string) => keys.findIndex((k) => k.key === account);

	if (quote.token === "SOL") {
		const transfers = instructions.filter((ix) => {
			const p = ix.parsed as
				| { type?: string; info?: Record<string, unknown> }
				| undefined;
			return (
				ix.program === "system" &&
				p?.type === "transfer" &&
				p.info?.destination === quote.destination
			);
		});
		if (transfers.length !== 1)
			return fail("Expected exactly one SOL transfer to the Treasury");
		const info = (transfers[0].parsed as { info: Record<string, unknown> })
			.info;
		if (info.source !== quote.wallet)
			return fail("The SOL did not come from the quoted wallet");
		if (BigInt(String(info.lamports)) !== amount)
			return fail("The SOL amount differs from the quote");
		const i = index(quote.destination);
		if (
			i < 0 ||
			BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]) < amount
		)
			return fail("The Treasury balance did not increase by the quoted amount");
		return { ok: true };
	}

	const transfers = instructions.filter((ix) => {
		const p = ix.parsed as
			| { type?: string; info?: Record<string, unknown> }
			| undefined;
		return (
			ix.program === "spl-token" &&
			(p?.type === "transferChecked" || p?.type === "transfer") &&
			p.info?.destination === quote.destination
		);
	});
	if (transfers.length !== 1)
		return fail("Expected exactly one USDC transfer to the Treasury");
	const parsed = transfers[0].parsed as {
		type: string;
		info: Record<string, unknown>;
	};
	if (parsed.type !== "transferChecked")
		return fail("The USDC transfer must name its mint");
	const info = parsed.info;
	const tokenAmount = info.tokenAmount as { amount?: string } | undefined;
	if (info.mint !== MAINNET_USDC_MINT)
		return fail("The payment is not mainnet USDC");
	if (
		info.authority !== quote.wallet &&
		info.multisigAuthority !== quote.wallet
	)
		return fail("The USDC was not sent by the quoted wallet");
	if (BigInt(tokenAmount?.amount ?? "-1") !== amount)
		return fail("The USDC amount differs from the quote");
	const i = index(quote.destination);
	const balance = (list: TokenBalance[] | null | undefined) =>
		BigInt(
			list?.find((b) => b.accountIndex === i && b.mint === MAINNET_USDC_MINT)
				?.uiTokenAmount.amount ?? "0",
		);
	if (
		i < 0 ||
		balance(tx.meta.postTokenBalances) - balance(tx.meta.preTokenBalances) <
			amount
	)
		return fail(
			"The Treasury USDC balance did not increase by the quoted amount",
		);
	return { ok: true };
}
