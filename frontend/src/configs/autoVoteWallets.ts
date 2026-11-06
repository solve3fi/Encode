import type { EncryptedSecret } from "@/lib/server/secretEncryption";

export const AUTO_VOTE_WALLETS_STORE = "admin-auto-vote-wallets";

export const AUTO_VOTE_WALLET_ADD_ACTION = "add admin auto-vote wallet";
export const AUTO_VOTE_WALLET_UPDATE_ACTION = "update admin auto-vote wallet";
export const AUTO_VOTE_WALLET_REMOVE_ACTION = "remove admin auto-vote wallet";

export type AutoVotePoolAllocation = {
	poolAddress: string;
	percent: number;
};

export type AdminAutoVoteWallet = {
	pubkey: string;
	label: string;
	encryptedSecretKey: EncryptedSecret;
	pools: AutoVotePoolAllocation[];
	addedBy: string;
	addedAt: number;
	updatedAt: number;
	lastVotedEpoch?: number;
	lastVotedAt?: number;
	lastSignature?: string;
	lastError?: string;
};

export type AdminAutoVoteWalletsById = Record<string, AdminAutoVoteWallet>;

// The public/GET shape — never carries encryptedSecretKey. Written once
// here so the API route and the admin UI share the exact same contract.
export type AdminAutoVoteWalletPublic = Omit<
	AdminAutoVoteWallet,
	"encryptedSecretKey"
>;

export const toPublicAutoVoteWallet = (
	wallet: AdminAutoVoteWallet,
): AdminAutoVoteWalletPublic => {
	const { encryptedSecretKey: _encryptedSecretKey, ...rest } = wallet;
	return rest;
};
