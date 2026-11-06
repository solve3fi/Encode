// Keep the implementation available while hiding all public Stocks entry points.
export const STOCKS_SECTION_ENABLED = false;

export type StockAsset = {
	chainId: number;
	mint: string;
	symbol: string;
	issuer: string;
};

// Listing registry, not a symbol heuristic. Add an issuer-confirmed mint only
// after eligibility, pool-program compatibility and corporate-action review.
// Intentionally empty: this UI release does not enable real or mock securities.
// Solana chain IDs: mainnet 101, devnet 102, testnet 103, localnet 104.
export const STOCK_ASSETS: readonly StockAsset[] = [];
