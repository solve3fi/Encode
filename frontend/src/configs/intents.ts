/**
 * Aurora Intents ("Fund from any chain"). Off unless NEXT_PUBLIC_INTENTS_ENABLED=true, and the server routes only work
 * when AURORA_INTENTS_API_KEY is set (server-only, never sent to the browser). Aurora Intents moves REAL assets and settles
 * on Solana mainnet, while the rest of the app runs on devnet: keep the mainnet warning on every screen of this feature.
 */
export const INTENTS_ENABLED =
	process.env.NEXT_PUBLIC_INTENTS_ENABLED === "true";

export const AURORA_INTENTS_API_BASE = "https://intents-api.aurora.dev";

/** Default and maximum slippage for cross-chain quotes, in basis points (100 = 1%). */
export const INTENTS_DEFAULT_SLIPPAGE_BPS = 100;
export const INTENTS_MAX_SLIPPAGE_BPS = 300;

/** What a person can receive on Solana through this feature. Other destinations are not offered. */
export const INTENTS_DESTINATION_SYMBOLS = ["SOL", "USDC"] as const;
export type IntentsDestinationSymbol =
	(typeof INTENTS_DESTINATION_SYMBOLS)[number];

/** Aurora's chain slug for Solana. */
export const SOLANA_CHAIN = "sol";
