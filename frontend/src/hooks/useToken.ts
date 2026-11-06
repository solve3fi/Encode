import { useConnection } from "@solana/wallet-adapter-react";
import { getMint } from "@solana/spl-token";
import {
	type TokenInfo,
	type TokenList,
	TokenListProvider,
} from "@solana/spl-token-registry";
import { PublicKey } from "@solana/web3.js";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
	DEFAULT_ACTIVE_LIST_URLS,
	DEFAULT_LIST_OF_LISTS,
} from "@/configs/constants";
import type { TokenLinksById } from "@/configs/tokenLinks";
import { SOLVE3_DEVNET_TOKENS } from "@/configs/tokens";
import { useChainId } from "@/providers/ClusterProvider";
import { fetchTokenList } from "@/utils/fetchTokenList";
import {
	type Mutable,
	type TokenAddressMap,
	tokensToChainTokenMap,
} from "@/utils/tokensToChainTokenMap";

interface TokenState {
	tokens: TokenInfo[];
	loading: boolean;
	error: Error | null;
}

export type TokenMap = { [address: string]: TokenInfo };

export const useTokensFromMap = (tokenMap: TokenAddressMap): TokenMap => {
	const chainId = useChainId();

	return Object.keys(tokenMap[chainId] ?? {}).reduce<{
		[address: string]: TokenInfo;
	}>((newMap, address) => {
		newMap[address] = tokenMap[chainId][address].token;
		return newMap;
	}, {});
};

export const combineMaps = (
	map1: TokenAddressMap,
	map2: TokenAddressMap,
): TokenAddressMap => {
	const chainIds = Object.keys(
		Object.keys(map1)
			.concat(Object.keys(map2))
			.reduce<{ [chainId: string]: true }>((memo, value) => {
				memo[value] = true;
				return memo;
			}, {}),
	).map((id) => Number.parseInt(id));

	return chainIds.reduce<Mutable<TokenAddressMap>>((memo, chainId) => {
		memo[chainId] = {
			...map2[chainId],
			...map1[chainId],
		};
		return memo;
	}, {}) as TokenAddressMap;
};

export const useAllLists = (): { [url: string]: TokenState } => {
	const listTokes = DEFAULT_LIST_OF_LISTS;

	const queries = useQueries({
		queries: listTokes.map((url) => ({
			queryKey: ["token", url],
			queryFn: async () => await fetchTokenList(url),
			select: (data: TokenList) => ({
				tokens: data.tokens,
				loading: false,
				error: null,
			}),
		})),
	});

	const result = listTokes.reduce<{ [url: string]: TokenState }>(
		(acc, url, index) => {
			const queryResult = queries[index];
			acc[url] = {
				tokens: queryResult.data?.tokens || [],
				loading: queryResult.isLoading,
				error: queryResult.error ? new Error(String(queryResult.error)) : null,
			};
			return acc;
		},
		{},
	);

	return result;
};

export const useResolveTokens = () => {
	const chainId = useChainId();
	return useQuery({
		queryKey: ["resolve-tokens"],
		queryFn: async () => {
			const tokens = await new TokenListProvider().resolve();
			const tokenList = tokens.filterByChainId(chainId).getList();
			return tokenList.reduce((map, item) => {
				map.set(item.address, item);
				return map;
			}, new Map<string, TokenInfo>());
		},
	});
};

export const useCombineTokenMapFromResolveTokens = () => {
	const { data: tokens } = useResolveTokens();
	return tokens
		? Array.from(tokens.entries())
				.filter(([_, data]) => data !== null)
				.map(([_, token]) => token)
				.filter(Boolean)
				.slice(0, 100)
		: [];
};

export const useCombinedTokenMapFromUrls = (
	urls: string[] | undefined,
): TokenAddressMap => {
	const allLists = useAllLists();
	if (!urls) return {};

	return urls.slice().reduce((allTokens, currentUrl) => {
		const current = allLists[currentUrl]?.tokens;
		if (!current) return allTokens;
		try {
			return combineMaps(allTokens, tokensToChainTokenMap(current));
		} catch (error) {
			console.error("Could not show token list due to error", error);
			return allTokens;
		}
	}, {});
};

export const useCombinedActiveList = (): TokenAddressMap => {
	const activeTokens = useCombinedTokenMapFromUrls(DEFAULT_ACTIVE_LIST_URLS);
	return activeTokens;
};

// Last-resort fallback for a mint that isn't on any known token list --
// swaps, pool creation, and LPs only need decimals to function, so resolve
// straight from the chain (no name/symbol/logo available) rather than
// refusing to let the user use a real, valid mint that just isn't branded
// anywhere. Only attempted once nothing above already answered.
const useOnChainTokenInfo = (
	address: string | undefined,
): TokenInfo | null | undefined => {
	const { connection } = useConnection();
	const chainId = useChainId();

	let mintPubkey: PublicKey | null = null;
	if (address) {
		try {
			mintPubkey = new PublicKey(address);
		} catch {
			mintPubkey = null;
		}
	}

	const { data, isLoading } = useQuery({
		queryKey: ["custom-token-mint", address, chainId],
		queryFn: async () => getMint(connection, mintPubkey as PublicKey),
		enabled: Boolean(mintPubkey),
		retry: false,
		staleTime: 60_000,
	});

	if (!mintPubkey) return null;
	if (isLoading) return undefined;
	if (!data) return null;

	return {
		chainId,
		address: mintPubkey.toBase58(),
		name: `Unlisted token ${address?.slice(0, 4)}…${address?.slice(-4)}`,
		symbol: `${address?.slice(0, 4)}…${address?.slice(-4)}`,
		decimals: data.decimals,
	};
};

export const useTokenFromMapOrNetwork = (
	tokens: TokenMap,
	tokenAddress?: string | null,
): TokenInfo | null | undefined => {
	const { data: tokenMap, isFetched: listsFetched } = useResolveTokens();

	const address = tokenAddress ?? undefined;
	const token: TokenInfo | null | undefined = address
		? tokens[address]
		: undefined;
	const listedToken = token ?? (address ? tokenMap?.get(address) : undefined);

	// Only try the network as a last resort, and only once the big token-list
	// registry has actually finished loading -- otherwise every address not
	// yet in the (still-loading) list would fire its own getMint RPC call.
	const onChainToken = useOnChainTokenInfo(
		!listedToken && listsFetched ? address : undefined,
	);

	if (listedToken) return listedToken;
	if (address && !listsFetched) return undefined; // still resolving the list
	return onChainToken;
};

// Admin-approved community token-listing requests (see src/configs/
// tokenRequests.ts) — merged in below so approval alone makes a pool show
// branded everywhere, no redeploy needed.
export const useCommunityApprovedTokens = (): TokenInfo[] => {
	const { data } = useQuery({
		queryKey: ["token-list-extra"],
		queryFn: async () => {
			const res = await fetch("/api/token-list-extra");
			if (!res.ok) throw new Error("Failed to load community token list");
			return (await res.json()) as TokenList;
		},
		staleTime: 60_000,
	});
	return data?.tokens ?? [];
};

// Admin-set website/X overrides for tokens that already resolve somewhere
// above (official SOLVE3_DEVNET_TOKENS entries included) — lets an admin add
// a project's links straight from /admin without going through the public
// token-request/approval flow, which only ever creates NEW entries and can't
// touch a token already in the official list. See src/configs/tokenLinks.ts.
export const useTokenLinkOverrides = (): TokenLinksById => {
	const { data } = useQuery({
		queryKey: ["admin-token-links"],
		queryFn: async () => {
			const res = await fetch("/api/admin/token-links");
			if (!res.ok) throw new Error("Failed to load token links");
			return (await res.json()) as TokenLinksById;
		},
		staleTime: 60_000,
	});
	return data ?? {};
};

export const useAllTokens = (): TokenMap => {
	const tokenMap = useCombinedActiveList();
	const solve3Tokens = tokensToChainTokenMap(SOLVE3_DEVNET_TOKENS);
	const communityTokens = tokensToChainTokenMap(useCommunityApprovedTokens());
	return useTokensFromMap(
		combineMaps(solve3Tokens, combineMaps(communityTokens, tokenMap)),
	);
};

export function useToken(
	tokenAddress?: string | null,
): TokenInfo | null | undefined {
	const tokens = useAllTokens();
	return useTokenFromMapOrNetwork(tokens, tokenAddress);
}

export const useTokens = (tokenAddresses: string[] | undefined) => {
	const tokens = useAllTokens();
	return tokenAddresses?.map((address) => tokens[address]);
};
