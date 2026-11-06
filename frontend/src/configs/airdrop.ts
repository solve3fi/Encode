import { PublicKey } from "@solana/web3.js";

// The airdrop distributes and locks the SAME SOLV3 mint vesolve's Protocol
// account already recognizes (Protocol.token_mint) — this is NOT the
// separate mint the `token` program (ve33-contracts/programs/token)
// manages. That mint's authority is a PDA only the vesolve program itself
// can sign for (used internally for emission distribution), so arbitrary
// airdrop transfers use this mint instead, from the devnet admin wallet's
// own balance.
export const AIRDROP_TOKEN_MINT = new PublicKey(
	"DvGitpT8Qujq6sxXoq7M1vueGf97dGVpoPWY4ifYHCHu",
);
export const AIRDROP_TOKEN_DECIMALS = 9;
export const AIRDROP_TOKEN_SYMBOL = "SOLV3";

// Eight 1% partner budgets; the other 2% of the 10% community pool is reserved.
export const AIRDROP_TOTAL_ALLOCATION = 8_000_000;
