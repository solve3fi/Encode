import { PublicKey } from "@solana/web3.js";

// Standalone devnet-only SPL mint created for this project's /devnet
// faucet — NOT the same as any real USDC mint, and NOT the SUPPORT_MINT_TOKENS
// entries in @/configs/lock.ts (that's SOLV3). Mint authority is the same
// devnet throwaway admin keypair used everywhere else in this project.
export const DEVNET_USDC_MINT = new PublicKey(
	"FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up",
);
export const DEVNET_USDC_DECIMALS = 6;
export const DEVNET_USDC_SYMBOL = "devUSDC";

export const FAUCET_CLAIM_AMOUNT = 100; // devUSDC per claim
export const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h per wallet
