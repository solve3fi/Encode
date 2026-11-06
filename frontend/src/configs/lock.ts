import type { TokenInfo } from "@solana/spl-token-registry";
import { SOLVE } from "@/configs/tokens";

// Token metadata for mints that can back a vesolve Lock, keyed by mint
// address (base58). SOLVE (SOLV3) is the only token the vesolve program's
// create_lock accepts today (constrained to protocol.token_mint on-chain).
// Once a Protocol account is initialized on a given network its real
// token_mint may differ from this placeholder address — add an entry here
// keyed by that mint once it's known.
export const SUPPORT_MINT_TOKENS: Record<string, TokenInfo> = {
	[SOLVE.address]: SOLVE,
	// Real veTokenMint from the devnet vesolve Protocol account initialized
	// during this project's integration testing (see ve33-contracts).
	"DvGitpT8Qujq6sxXoq7M1vueGf97dGVpoPWY4ifYHCHu": {
		chainId: 102,
		address: "DvGitpT8Qujq6sxXoq7M1vueGf97dGVpoPWY4ifYHCHu",
		symbol: "SOLV3",
		name: "SOLV3 (devnet)",
		decimals: 9,
		logoURI: "/assets/tokens/solv3.png",
	},
};

// Fallback for any lockTokenMint not in SUPPORT_MINT_TOKENS above, so an
// unrecognized (e.g. redeployed-to-a-new-address) mint degrades to a
// truncated-address label instead of crashing on `.symbol`/`.decimals` of
// undefined.
export const getLockTokenInfo = (mint: string): TokenInfo =>
	SUPPORT_MINT_TOKENS[mint] ?? {
		chainId: 0,
		address: mint,
		symbol: `${mint.slice(0, 4)}…`,
		name: mint,
		decimals: 9,
		logoURI: "/assets/tokens/solv3.png",
	};
