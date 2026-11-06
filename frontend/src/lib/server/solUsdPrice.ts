import "server-only";

/**
 * SOL/USD for presale quotes, from two independent public sources (Jupiter and Coinbase). The quote uses the lower of
 * the two (the buyer never pays less than the sale price) and is refused when either source is unavailable or they
 * disagree by more than MAX_SPREAD: a wrong price here sells veSOLV3 below $0.20, so it fails closed.
 */

const SOL_MINT = "So11111111111111111111111111111111111111112";
const MAX_SPREAD = 0.01;
const TIMEOUT_MS = 5_000;

type Fetcher = (url: string) => Promise<unknown>;
const defaultFetch: Fetcher = async (url) => {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
		cache: "no-store",
	});
	if (!response.ok) throw new Error(`price source ${response.status}`);
	return response.json();
};

const positive = (value: unknown) => {
	const n = typeof value === "string" ? Number(value) : value;
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

export async function solUsdPrice(
	get: Fetcher = defaultFetch,
): Promise<number> {
	const [jupiter, coinbase] = await Promise.all([
		get(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`)
			.then((body) =>
				positive(
					(body as Record<string, { usdPrice?: unknown }>)[SOL_MINT]?.usdPrice,
				),
			)
			.catch(() => null),
		get("https://api.coinbase.com/v2/prices/SOL-USD/spot")
			.then((body) => {
				const data = (
					body as {
						data?: { amount?: unknown; base?: unknown; currency?: unknown };
					}
				).data;
				return data?.base === "SOL" && data?.currency === "USD"
					? positive(data.amount)
					: null;
			})
			.catch(() => null),
	]);
	if (jupiter === null || coinbase === null)
		throw new Error("SOL price unavailable, try again shortly");
	const low = Math.min(jupiter, coinbase);
	if (Math.abs(jupiter - coinbase) / low > MAX_SPREAD)
		throw new Error("SOL price sources disagree, try again shortly");
	return low;
}

/** Lamports for `usd` at `priceUsd` per SOL, rounded up so the Treasury never receives less than the sale price. */
export function lamportsForUsd(usd: number, priceUsd: number): bigint {
	// Work in micro-USD and price units of 1e-6 USD to stay exact.
	const usdMicro = BigInt(usd) * BigInt(1_000_000);
	const priceMicro = BigInt(Math.floor(priceUsd * 1_000_000));
	if (priceMicro <= BigInt(0)) throw new Error("Invalid SOL price");
	return (
		(usdMicro * BigInt(1_000_000_000) + priceMicro - BigInt(1)) / priceMicro
	);
}
