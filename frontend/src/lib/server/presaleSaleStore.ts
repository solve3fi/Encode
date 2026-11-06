import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
	PAYMENT_GRACE_MS,
	QUOTE_TTL_MS,
	SALE_PRICE_USD,
	type SaleConfig,
	type SalePhase,
	type SaleQuote,
	type SaleStatus,
	type SaleToken,
	veSolv3For,
} from "@/configs/presaleSale";

/**
 * The presale round-2 ledger: the admin's sale settings, live quotes (each holds its share of the cap until it
 * expires) and confirmed purchases keyed by payment signature (one purchase per payment, ever). One JSON file written
 * atomically (temp file + rename) under a process-wide lock, plus an append-only JSONL log of every change. The site
 * runs as a single container, so the in-process lock serialises every writer.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "presale-round2.json");
const LOG_FILE = path.join(DATA_DIR, "presale-round2.log.jsonl");

export type SalePurchase = {
	signature: string;
	quoteId: string;
	wallet: string;
	token: SaleToken;
	usd: number;
	veSolv3Raw: string;
	amountRaw: string;
	solPriceUsd: number | null;
	at: string;
};
type State = {
	config: SaleConfig | null;
	configUpdatedBy?: string;
	configUpdatedAt?: string;
	quotes: Record<string, SaleQuote & { confirmedSignature?: string }>;
	purchases: Record<string, SalePurchase>;
};
const EMPTY: State = { config: null, quotes: {}, purchases: {} };

let chain: Promise<unknown> = Promise.resolve();
/** Runs `fn` with exclusive access to the ledger. */
export function withSaleLedger<T>(
	fn: (state: State, save: (next: State) => Promise<void>) => Promise<T>,
): Promise<T> {
	const run = chain.then(async () => fn(await readState(), writeState));
	chain = run.catch(() => undefined);
	return run;
}

async function readState(): Promise<State> {
	try {
		return {
			...EMPTY,
			...(JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as State),
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			return structuredClone(EMPTY);
		throw error;
	}
}

async function writeState(next: State) {
	await fs.mkdir(DATA_DIR, { recursive: true });
	const tmp = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
	await fs.rename(tmp, STATE_FILE);
}

export async function appendSaleLog(entry: Record<string, unknown>) {
	await fs.mkdir(DATA_DIR, { recursive: true });
	await fs.appendFile(
		LOG_FILE,
		`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
		"utf8",
	);
}

// A quote keeps its share until its payment can no longer be accepted (expiry plus the payment grace), so a payment
// confirmed late can never take the sale over the cap.
const live = (q: SaleQuote & { confirmedSignature?: string }, now: number) =>
	!q.confirmedSignature && Date.parse(q.expiresAt) + PAYMENT_GRACE_MS > now;

/** Totals that every limit is checked against: confirmed purchases plus quotes still holding their share. */
export function saleTotals(state: State, now: number, wallet?: string) {
	const purchases = Object.values(state.purchases);
	const soldUsd = purchases.reduce((s, p) => s + p.usd, 0);
	const reservedUsd = Object.values(state.quotes)
		.filter((q) => live(q, now))
		.reduce((s, q) => s + q.usd, 0);
	const mine = wallet ? purchases.filter((p) => p.wallet === wallet) : [];
	const myReservedUsd = wallet
		? Object.values(state.quotes)
				.filter((q) => q.wallet === wallet && live(q, now))
				.reduce((s, q) => s + q.usd, 0)
		: 0;
	return {
		soldUsd,
		reservedUsd,
		buyers: new Set(purchases.map((p) => p.wallet)).size,
		mine,
		myPurchasedUsd: mine.reduce((s, p) => s + p.usd, 0),
		myReservedUsd,
	};
}

export function salePhase(
	config: SaleConfig | null,
	soldUsd: number,
	now: number,
): SalePhase {
	if (!config) return "NOT_CONFIGURED";
	if (now < Date.parse(config.startsAt)) return "UPCOMING";
	if (now >= Date.parse(config.endsAt)) return "ENDED";
	if (soldUsd >= config.hardCapUsd) return "SOLD_OUT";
	return "OPEN";
}

export function saleStatus(
	state: State,
	now: number,
	wallet?: string,
): SaleStatus {
	const t = saleTotals(state, now, wallet);
	const cap = state.config?.hardCapUsd ?? 0;
	const status: SaleStatus = {
		phase: salePhase(state.config, t.soldUsd, now),
		priceUsd: SALE_PRICE_USD,
		config: state.config,
		soldUsd: t.soldUsd,
		reservedUsd: t.reservedUsd,
		remainingUsd: Math.max(0, cap - t.soldUsd - t.reservedUsd),
		buyers: t.buyers,
	};
	if (wallet) {
		const max = state.config?.maxUsdPerWallet ?? 0;
		status.wallet = {
			address: wallet,
			purchasedUsd: t.myPurchasedUsd,
			veSolv3: t.mine.reduce(
				(s, p) => s + Number(BigInt(p.veSolv3Raw) / BigInt(1_000_000)) / 1000,
				0,
			),
			remainingUsd: Math.max(
				0,
				Math.min(
					max - t.myPurchasedUsd - t.myReservedUsd,
					cap - t.soldUsd - t.reservedUsd,
				),
			),
			purchases: t.mine
				.sort((a, b) => a.at.localeCompare(b.at))
				.map((p) => ({
					signature: p.signature,
					token: p.token,
					usd: p.usd,
					veSolv3: Number(BigInt(p.veSolv3Raw) / BigInt(1_000_000)) / 1000,
					at: p.at,
				})),
		};
	}
	return status;
}

/** Checks a requested purchase against the window, the cap and the wallet's limits. Returns an error or null. */
export function quoteRefusal(
	state: State,
	now: number,
	wallet: string,
	usd: number,
): string | null {
	const config = state.config;
	const t = saleTotals(state, now, wallet);
	const phase = salePhase(config, t.soldUsd, now);
	if (!config || phase === "NOT_CONFIGURED")
		return "The presale is not open yet";
	if (phase === "UPCOMING") return "The presale has not started yet";
	if (phase === "ENDED") return "The presale has ended";
	if (phase === "SOLD_OUT") return "The presale is sold out";
	if (!Number.isSafeInteger(usd) || usd < config.minUsd)
		return `The minimum purchase is $${config.minUsd}`;
	if (t.myPurchasedUsd + t.myReservedUsd + usd > config.maxUsdPerWallet)
		return `That would take this wallet over its $${config.maxUsdPerWallet} limit`;
	if (t.soldUsd + t.reservedUsd + usd > config.hardCapUsd)
		return "That is more than the presale has left";
	return null;
}

export const newQuoteId = () => randomBytes(12).toString("hex");
export const quoteMemo = (id: string) => `solve3-presale:${id}`;
export const quoteVeSolv3Raw = (usd: number) =>
	veSolv3For(BigInt(usd) * BigInt(1_000_000));
export const quoteExpiry = (now: number) =>
	new Date(now + QUOTE_TTL_MS).toISOString();
