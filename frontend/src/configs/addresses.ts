import { PublicKey } from "@solana/web3.js";
import { ClusterNetwork } from "@/providers/ClusterProvider";

export const DEVNET_DEX_PROGRAM_ADDRESS =
	"HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK";
export const DEVNET_VE_PROGRAM_ADDRESS =
	"HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN";

export const DEX_PROGRAM_ID = {
	// Mainnet's solve program was closed (see M-03 / mainnet incident notes) —
	// left pointing at the dead address until a real mainnet redeploy happens.
	[ClusterNetwork.Mainnet]: new PublicKey(
		"Hvk9udYr7cFfsXN2yTKb94A5pLM7H9YvAQtnV5JQfwvz",
	),
	[ClusterNetwork.Testnet]: new PublicKey(
		"Hvk9udYr7cFfsXN2yTKb94A5pLM7H9YvAQtnV5JQfwvz",
	),
	// Redeployed from ve33-contracts (solve/2026-prebuild, post security-audit
	// fixes) to devnet for testing.
	[ClusterNetwork.Devnet]: new PublicKey(DEVNET_DEX_PROGRAM_ADDRESS),
	[ClusterNetwork.Localnet]: new PublicKey(
		"Hvk9udYr7cFfsXN2yTKb94A5pLM7H9YvAQtnV5JQfwvz",
	),
};

// ve(3,3) vote-escrow lock/vote/reward program. Only deployed on devnet so
// far — PublicKey.default() marks networks where it was never deployed
// (this program has never existed on mainnet/testnet/localnet, unlike
// DEX_PROGRAM_ID above which points at solve's now-closed mainnet address).
export const VE_PROGRAM_ID = {
	[ClusterNetwork.Mainnet]: PublicKey.default,
	[ClusterNetwork.Testnet]: PublicKey.default,
	[ClusterNetwork.Devnet]: new PublicKey(DEVNET_VE_PROGRAM_ADDRESS),
	[ClusterNetwork.Localnet]: PublicKey.default,
};

// SOLV3 mint/minting program. Only deployed on devnet so far — see
// VE_PROGRAM_ID above for why the other networks use PublicKey.default().
export const TOKEN_PROGRAM_CONFIG_ID = {
	[ClusterNetwork.Mainnet]: PublicKey.default,
	[ClusterNetwork.Testnet]: PublicKey.default,
	[ClusterNetwork.Devnet]: new PublicKey(
		"CKRSmDf3n1ZsAc91YyRyCwWLoNShZ4xi2nWESMbDw7Pw",
	),
	[ClusterNetwork.Localnet]: PublicKey.default,
};

export const PROGRAM_CONFIG = {
	[ClusterNetwork.Mainnet]: new PublicKey(
		"FWv7G8LcHMiNgpzn7srEaFQi44T4hbC5qtYqjD8Ay4Qx",
	),
	[ClusterNetwork.Testnet]: new PublicKey(
		"FWv7G8LcHMiNgpzn7srEaFQi44T4hbC5qtYqjD8Ay4Qx",
	),
	// Real SolvesConfig account, initialized on devnet against DEX_PROGRAM_ID
	// above during integration testing (owns the solve pool created there).
	[ClusterNetwork.Devnet]: new PublicKey(
		"F2QtwRjDpdVR25n3ZMWpmAKdMK21LDdi3pTGUTc8ELef",
	),
	[ClusterNetwork.Localnet]: new PublicKey(
		"FWv7G8LcHMiNgpzn7srEaFQi44T4hbC5qtYqjD8Ay4Qx",
	),
};

export const PROGRAM_CONFIG_EXTENSION = {
	[ClusterNetwork.Mainnet]: new PublicKey(
		"7XTopmgkUnSU4PrDFNBPTZB5A7Su9GSAvQqsujsVrYh3",
	),
	[ClusterNetwork.Testnet]: new PublicKey(
		"7XTopmgkUnSU4PrDFNBPTZB5A7Su9GSAvQqsujsVrYh3",
	),
	[ClusterNetwork.Devnet]: new PublicKey(
		"7XTopmgkUnSU4PrDFNBPTZB5A7Su9GSAvQqsujsVrYh3",
	),
	[ClusterNetwork.Localnet]: new PublicKey(
		"7XTopmgkUnSU4PrDFNBPTZB5A7Su9GSAvQqsujsVrYh3",
	),
};
