export const DEFAULT_TOKEN_LIST_URLS =
	"https://raw.githubusercontent.com/solve3fi/token-list/refs/heads/main/src/tokens/solana.tokenlist.json";

export const LOCALNET_TOKEN_LIST_URLS = "./tokens/default.tokenlist.json";

export const DEFAULT_ACTIVE_LIST_URLS: string[] = [
	DEFAULT_TOKEN_LIST_URLS,
	LOCALNET_TOKEN_LIST_URLS,
];

export const DEFAULT_LIST_OF_LISTS: string[] = [...DEFAULT_ACTIVE_LIST_URLS];
