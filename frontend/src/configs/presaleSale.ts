/**
 * Presale round 2: veSOLV3 sold for mainnet USDC or SOL, paid straight to the Treasury and claimed as a permanent
 * veSOLV3 lock at mainnet launch. Shared by the page, the API routes and the admin panel (no server-only imports).
 *
 * Decided by Seth (2026-10-09): $0.20 per veSOLV3, mainnet USDC + SOL, claim at mainnet launch, a hard cap, per-wallet
 * min/max and a sale window. The cap, limits, window and receiving Treasury are set in Admin > Presale; the sale stays
 * closed until they are.
 */

/** The public sale page (/sale) and its menu entries are hidden unless this build flag is set; Admin › Presale works regardless. */
export const SALE_PAGE_ENABLED =
	process.env.NEXT_PUBLIC_PRESALE_SALE_ENABLED === "true";

export const SALE_PRICE_USD = 0.2;
/** Integer micro-USD per veSOLV3 (exact arithmetic for quotes and totals). */
export const SALE_PRICE_MICRO_USD = BigInt(200_000);

export const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;
export const SALE_TOKENS = ["USDC", "SOL"] as const;
export type SaleToken = (typeof SALE_TOKENS)[number];

/** How long a quote holds its share of the cap and its SOL price. */
export const QUOTE_TTL_MS = 120_000;
/** A payment may land this long after the quote expired (it was signed in time but the network was slow). */
export const PAYMENT_GRACE_MS = 90_000;

export const SALE_STATUS_PATH = "/api/presale-sale/status";
export const SALE_QUOTE_PATH = "/api/presale-sale/quote";
export const SALE_CONFIRM_PATH = "/api/presale-sale/confirm";
export const SALE_ADMIN_PATH = "/api/admin/presale-sale";
export const SALE_ADMIN_SAVE_ACTION = "presale sale config";
export const SALE_ADMIN_READ_ACTION = "presale sale ledger";
export const SALE_ADMIN_PUBLISH_ACTION = "presale round 2 claims";

export type SaleConfig = {
	startsAt: string; // ISO 8601
	endsAt: string; // ISO 8601
	hardCapUsd: number; // whole dollars
	minUsd: number; // per purchase
	maxUsdPerWallet: number; // across all of a wallet's purchases
	treasury: string; // mainnet wallet that receives USDC and SOL
};

export type SalePhase =
	| "NOT_CONFIGURED"
	| "UPCOMING"
	| "OPEN"
	| "SOLD_OUT"
	| "ENDED";

export type SaleStatus = {
	phase: SalePhase;
	priceUsd: number;
	config: SaleConfig | null;
	soldUsd: number;
	reservedUsd: number;
	remainingUsd: number;
	buyers: number;
	wallet?: {
		address: string;
		purchasedUsd: number;
		veSolv3: number;
		remainingUsd: number;
		purchases: {
			signature: string;
			token: SaleToken;
			usd: number;
			veSolv3: number;
			at: string;
		}[];
	};
};

export type SaleQuote = {
	id: string;
	wallet: string;
	token: SaleToken;
	usd: number;
	veSolv3: number;
	amountRaw: string; // lamports or USDC base units the buyer must send, exactly
	solPriceUsd: number | null;
	treasury: string;
	destination: string; // the account that must receive it: the Treasury wallet (SOL) or its USDC token account
	memo: string; // carried in the payment so the server can tie the transfer to this quote
	createdAt: string;
	expiresAt: string;
};

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const wholeDollars = (value: unknown) =>
	typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Returns the normalised config or a client-safe error. */
export function validateSaleConfig(
	input: unknown,
): { config: SaleConfig } | { error: string } {
	const c = input as Partial<SaleConfig> | null;
	if (!c || typeof c !== "object") return { error: "Missing sale settings" };
	const starts = Date.parse(String(c.startsAt));
	const ends = Date.parse(String(c.endsAt));
	if (!Number.isFinite(starts) || !Number.isFinite(ends))
		return { error: "Start and end must be valid dates" };
	if (ends <= starts) return { error: "The sale must end after it starts" };
	if (!wholeDollars(c.hardCapUsd))
		return { error: "The hard cap must be a whole number of dollars above 0" };
	if (!wholeDollars(c.minUsd))
		return { error: "The minimum must be a whole number of dollars above 0" };
	if (!wholeDollars(c.maxUsdPerWallet))
		return {
			error: "The per-wallet maximum must be a whole number of dollars above 0",
		};
	if ((c.minUsd as number) > (c.maxUsdPerWallet as number))
		return { error: "The minimum cannot exceed the per-wallet maximum" };
	if ((c.maxUsdPerWallet as number) > (c.hardCapUsd as number))
		return { error: "The per-wallet maximum cannot exceed the hard cap" };
	if (typeof c.treasury !== "string" || !BASE58.test(c.treasury))
		return { error: "The Treasury must be a Solana address" };
	return {
		config: {
			startsAt: new Date(starts).toISOString(),
			endsAt: new Date(ends).toISOString(),
			hardCapUsd: c.hardCapUsd as number,
			minUsd: c.minUsd as number,
			maxUsdPerWallet: c.maxUsdPerWallet as number,
			treasury: c.treasury,
		},
	};
}

/** veSOLV3 bought for `usd` at the sale price (9 decimals, exact). */
export const veSolv3For = (usdMicro: bigint) =>
	(usdMicro * BigInt(1_000_000_000)) / SALE_PRICE_MICRO_USD;
