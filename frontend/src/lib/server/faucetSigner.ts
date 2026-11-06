import "server-only";
import { createRpcFetch, PUBLIC_DEVNET_RPC } from "./mainnetRpcFetch";
import { Connection, Keypair } from "@solana/web3.js";

// Server-only signer for /api/faucet and /api/airdrop. Reads the secret key
// from FAUCET_AUTHORITY_SECRET_KEY (no NEXT_PUBLIC_ prefix — never bundled
// to the client). This is the project's devnet-only throwaway admin
// keypair, already used as a signer throughout this project's tooling.
let cachedKeypair: Keypair | null = null;

export const getFaucetAuthority = (): Keypair => {
	if (cachedKeypair) return cachedKeypair;

	const raw = process.env.FAUCET_AUTHORITY_SECRET_KEY;
	if (!raw) {
		throw new Error(
			"FAUCET_AUTHORITY_SECRET_KEY is not set — add it to .env.local",
		);
	}
	const secretKey = Uint8Array.from(JSON.parse(raw));
	cachedKeypair = Keypair.fromSecretKey(secretKey);
	return cachedKeypair;
};

let cachedConnection: Connection | null = null;

export const getFaucetConnection = (): Connection => {
	if (!cachedConnection) {
		const endpoint = process.env.SOLVE3_DEVNET_RPC_URL || PUBLIC_DEVNET_RPC;
		cachedConnection = new Connection(endpoint, {
			commitment: "confirmed", disableRetryOnRateLimit: true,
			fetch: createRpcFetch(endpoint, "devnet"),
		});
	}
	return cachedConnection;
};
