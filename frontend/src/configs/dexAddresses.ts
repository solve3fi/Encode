// Raw DEX program and config addresses, kept free of React/client imports so
// server route handlers can use them (configs/addresses.ts imports the
// "use client" ClusterProvider, which does not cross into route handlers).
//
// Mainnet values can be set at build time for the mainnet redeploy
// (NEXT_PUBLIC_MAINNET_DEX_PROGRAM_ID, NEXT_PUBLIC_MAINNET_PROGRAM_CONFIG,
// NEXT_PUBLIC_MAINNET_PROGRAM_CONFIG_EXTENSION). Unset, the program and config
// default to the 2026-10-17 mainnet redeploy: the Solve program at the same
// address as devnet, and the SolvesConfig that owns the SOL/USDC pool
// uy81yVcSadVN9jgFpESYuDqCSgtGZFHEjdECghB7UYW (0.05% fee tier). The original
// mainnet program (LEGACY_*) was closed; see M-03 / mainnet incident notes.
const orFallback = (value: string | undefined, fallback: string) =>
	value?.trim() || fallback;

export const LEGACY_DEX_PROGRAM_ADDRESS =
	"Hvk9udYr7cFfsXN2yTKb94A5pLM7H9YvAQtnV5JQfwvz";
export const LEGACY_PROGRAM_CONFIG_ADDRESS =
	"FWv7G8LcHMiNgpzn7srEaFQi44T4hbC5qtYqjD8Ay4Qx";
export const LEGACY_PROGRAM_CONFIG_EXTENSION_ADDRESS =
	"7XTopmgkUnSU4PrDFNBPTZB5A7Su9GSAvQqsujsVrYh3";

export const MAINNET_DEX_PROGRAM_ADDRESS = orFallback(
	process.env.NEXT_PUBLIC_MAINNET_DEX_PROGRAM_ID,
	"HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK",
);
export const MAINNET_PROGRAM_CONFIG_ADDRESS = orFallback(
	process.env.NEXT_PUBLIC_MAINNET_PROGRAM_CONFIG,
	"4k83mFMsQXsm48JnZ1jE6qEYQ4iG6wbd1anvf8owkhjv",
);
export const MAINNET_PROGRAM_CONFIG_EXTENSION_ADDRESS = orFallback(
	process.env.NEXT_PUBLIC_MAINNET_PROGRAM_CONFIG_EXTENSION,
	LEGACY_PROGRAM_CONFIG_EXTENSION_ADDRESS,
);

export const DEVNET_DEX_PROGRAM_ADDRESS =
	"HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK";
// Real SolvesConfig account, initialized on devnet against the devnet DEX
// program during integration testing (owns the solve pool created there).
export const DEVNET_PROGRAM_CONFIG_ADDRESS =
	"F2QtwRjDpdVR25n3ZMWpmAKdMK21LDdi3pTGUTc8ELef";

// Kept raw so server RPC policy does not import React/client configuration.
export const DEVNET_VE_PROGRAM_ADDRESS =
	"HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN";
