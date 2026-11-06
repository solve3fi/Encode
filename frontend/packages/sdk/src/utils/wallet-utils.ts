import type { Wallet } from "@solve3fi/common";
import { PublicKey } from "@solana/web3.js";

/**
 * Checks if a wallet is connected.
 * @category Solve Utils
 * @param wallet The wallet to check.
 * @returns True if the wallet is connected, false otherwise.
 */
export function isWalletConnected(wallet: Wallet | null): boolean {
  return wallet !== null && !wallet.publicKey.equals(PublicKey.default);
}
