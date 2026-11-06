import type { TokenInfo } from "@solana/spl-token-registry";
import {
	DEVNET_USDC_DECIMALS,
	DEVNET_USDC_MINT,
	DEVNET_USDC_SYMBOL,
} from "@/configs/devnetFaucet";
import { ClusterNetwork } from "@/providers/ClusterProvider";

export const SOL: TokenInfo = {
	chainId: 101,
	address: "So11111111111111111111111111111111111111112",
	symbol: "SOL",
	name: "Wrapped SOL",
	decimals: 9,
	logoURI: "/assets/tokens/sol.png",
};

export const USDC: TokenInfo = {
	chainId: 101,
	address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
	symbol: "USDC",
	name: "USDC",
	decimals: 6,
	logoURI: "/assets/tokens/usdc.png",
};

const USDT: TokenInfo = {
	chainId: 101,
	address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
	symbol: "USDT",
	name: "USDT",
	decimals: 6,
	logoURI:
		"https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",
};

const BTC: TokenInfo = {
	chainId: 101,
	address: "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
	symbol: "BTC",
	name: "Wrapped Bitcoin (Sollet)",
	decimals: 6,
	logoURI:
		"https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E/logo.png",
};

const ETH: TokenInfo = {
	chainId: 101,
	address: "2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk",
	symbol: "ETH",
	name: "Wrapped Ethereum (Sollet)",
	decimals: 6,
	logoURI:
		"https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk/logo.png",
};

export const SOLVE: TokenInfo = {
	chainId: 102,
	address: "DvGitpT8Qujq6sxXoq7M1vueGf97dGVpoPWY4ifYHCHu",
	symbol: "SOLV3",
	name: "SOLV3",
	decimals: 9,
	logoURI: "/assets/tokens/solv3.png",
};

export const DEVNET_SOL: TokenInfo = {
	...SOL,
	chainId: 102,
};

export const DEVNET_MEME_TOKENS: TokenInfo[] = [
	{
		chainId: 102,
		address: "6RydWWDfVxTgmDWHSwrcEitrjySqMohnf4vfSWx4ka1f",
		symbol: "tSOL",
		name: "Test SOL (Devnet)",
		decimals: 9,
		logoURI: "/assets/tokens/wif3.svg",
	},
	{
		chainId: 102,
		address: "BdsGWxAqx8FkoMrG4XXPhVnJYw63TnrNEyUgGS8idxm7",
		symbol: "TBRIBE",
		name: "Test Bribe Token (Devnet)",
		decimals: 6,
		logoURI: "/assets/tokens/bonk3.svg",
	},
	{
		chainId: 102,
		address: "4xfieJrDKC7HKNCa3MD6MWBCNXgJriu8dBmTNH2kZco9",
		symbol: "MCAT",
		name: "Moon Cat (Devnet)",
		decimals: 6,
		logoURI: "/assets/tokens/mcat.svg",
	},
	{
		chainId: 102,
		address: "GmStztiTmg583BBZi3KadDLR7UQe5z31qJipNkc1ZiTp",
		symbol: "FROGE",
		name: "Froge (Devnet)",
		decimals: 6,
		logoURI: "/assets/tokens/froge.svg",
	},
	{
		chainId: 102,
		address: "GfrL1u8rxFcKZ4YUaMcQUwFUZLTAythwSuWUj5vfToDK",
		symbol: "NOOT",
		name: "Noot Noot (Devnet)",
		decimals: 6,
		logoURI: "/assets/tokens/noot.svg",
	},
	{
		chainId: 102,
		address: "HQrsMgKjZCfY7wGTKwijN1285ZJGVYrScjf9Zda3i8zB",
		symbol: "PNUT",
		name: "Peanut (Devnet)",
		decimals: 6,
		logoURI: "/assets/tokens/pnut.svg",
	},
	{
		chainId: 102,
		address: "B8gbymeWCAfvUBWh2i4nSmVm276rvysDdy6fSouzZBTb",
		symbol: "WAGMI",
		name: "WAGMI (Devnet)",
		decimals: 6,
		logoURI: "/assets/tokens/wagmi.svg",
	},
];

// The /devnet faucet's mint (see @/configs/devnetFaucet) — registered here
// so the swap/pool token pickers (both built on useAllTokens()) can resolve
// it. Without an entry here, claimed devUSDC sits in the wallet but is
// invisible to any token-select UI, making the faucet look broken even
// though the mint itself succeeds.
export const DEVNET_USDC: TokenInfo = {
	chainId: 102,
	address: DEVNET_USDC_MINT.toString(),
	symbol: DEVNET_USDC_SYMBOL,
	name: "USD Coin (Devnet)",
	decimals: DEVNET_USDC_DECIMALS,
	logoURI: "/assets/tokens/usdc.png",
};

export const SOLVE3_DEVNET_TOKENS: TokenInfo[] = [
	DEVNET_SOL,
	SOLVE,
	DEVNET_USDC,
	...DEVNET_MEME_TOKENS,
];

export const XSOLVE: TokenInfo = {
	chainId: 104,
	address: "AuWNjJrBhuyRna415rW1S6StEjs4TFUTgu6bF7CYrCo1",
	symbol: "xSOLV3",
	name: "xSOLV3",
	decimals: 9,
	logoURI: "/assets/tokens/xsolv3.png",
};

export const BASE_TOKENS: Record<ClusterNetwork, [TokenInfo, TokenInfo]> = {
	[ClusterNetwork.Localnet]: [SOL, USDC],
	// No SOL pool exists on devnet: default to the faucet token and SOLV3, which have a route.
	[ClusterNetwork.Devnet]: [DEVNET_USDC, SOLVE],
	[ClusterNetwork.Testnet]: [SOL, USDC],
	[ClusterNetwork.Mainnet]: [SOL, USDC],
};

export const COMMON_BASES: Record<ClusterNetwork, TokenInfo[]> = {
	[ClusterNetwork.Localnet]: [SOL, USDC],
	[ClusterNetwork.Devnet]: [DEVNET_SOL, SOLVE, DEVNET_USDC, ...DEVNET_MEME_TOKENS],
	[ClusterNetwork.Testnet]: [SOL, USDC],
	[ClusterNetwork.Mainnet]: [SOL, USDC, USDT, BTC],
};
