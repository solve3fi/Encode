import { PublicKey } from "@solana/web3.js";

export const PROTOCOL_SEED = "protocol";
export const VE_LOCK_SEED = "ve_lock";
export const VE_TOKEN_SEED = "ve_token";
export const GAUGE_SEED = "gauge";
export const VAULT_SEED = "vault";
export const USER_VOTE_SEED = "user_vote";
export const BRIBE_SEED = "bribe";
export const EPOCH_DATA_SEED = "epoch_data";
export const USER_REWARDS_SEED = "user_rewards";
export const USER_POOL_REWARDS_SEED = "user_pool_rewards";
export const USER_BRIBE_REWARDS_SEED = "user_bribe_rewards";

export const getProtocolPDA = (programId: PublicKey): [PublicKey, number] => {
	return PublicKey.findProgramAddressSync(
		[Buffer.from(PROTOCOL_SEED)],
		programId,
	);
};
