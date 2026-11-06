import { PublicKey } from "@solana/web3.js";

/**
 * The shared partner voter: one wallet, flagged by the Admin on chain (set_partner_voter), that votes partner locks so
 * they pay no auto-vote fee. Its private key lives only on the keeper server; this is the public address. The portal uses it only
 * once the Admin has flagged it on chain.
 */
// Default: the shared partner voter on the live devnet deployment (a public address). The portal only offers the free
// option when this wallet is also flagged on chain, so a wrong default on another cluster stays inert. Set
// NEXT_PUBLIC_PARTNER_VOTER to override it (for example on mainnet).
const DEFAULT_PARTNER_VOTER = "GpEdUweDTExoy4UQLWsDZgAhdQSpuNnXejxgaNmZre1B";
const raw = process.env.NEXT_PUBLIC_PARTNER_VOTER || DEFAULT_PARTNER_VOTER;

export const PARTNER_VOTER: PublicKey | null = (() => {
	if (!raw) return null;
	try {
		return new PublicKey(raw);
	} catch {
		return null;
	}
})();
