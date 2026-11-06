import { AIRDROP_TOKEN_MINT } from "@/configs/airdrop";

// Same SOLV3 mint the airdrop distributes from the admin wallet's own
// balance — see the comment on AIRDROP_TOKEN_MINT for why this mint
// specifically (not the token program's own mint, which only its own PDA
// can sign for).
export const PRESALE_TOKEN_MINT = AIRDROP_TOKEN_MINT;
export const PRESALE_TOKEN_DECIMALS = 9;
export const PRESALE_TOKEN_SYMBOL = "SOLV3";

// $0.12 per SOLV3 — confirmed by reverse-dividing every row of the supplied
// buyer sheet (amountUsd / veSolv3Amount is exactly 0.12 for all 18 rows).
export const PRESALE_PRICE_USD = 0.12;
