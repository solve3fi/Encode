import {
	type Connection,
	LAMPORTS_PER_SOL,
	type PublicKey,
} from "@solana/web3.js";

// A claim's create_lock is paid by the claimant: network fee plus rent for the lock, the veNFT mint, its token
// account and metadata, measured at ~0.0175 SOL on devnet. Checked before the server builds (and reserves) the claim,
// so a wallet without SOL never leaves a half-made claim behind.
export const MIN_CLAIM_LAMPORTS = 20_000_000;
export const MIN_CLAIM_SOL = MIN_CLAIM_LAMPORTS / LAMPORTS_PER_SOL;

export const hasClaimGas = async (connection: Connection, owner: PublicKey) =>
	(await connection.getBalance(owner, "confirmed")) >= MIN_CLAIM_LAMPORTS;
