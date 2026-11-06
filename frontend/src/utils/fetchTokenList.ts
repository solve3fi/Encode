import type { TokenList } from "@solana/spl-token-registry";
import localList from "@/configs/tokenLists/default.tokenlist.json";

const listCache = new Map<string, TokenList>();

export const fetchTokenList = async (listUrl: string): Promise<TokenList> => {
	const cached = listCache.get(listUrl);
	if (cached) return cached;

	try {
		let list: TokenList;
		if (listUrl.startsWith("http")) {
			const response = await fetch(listUrl);
			list = await response.json();
		} else {
			// TODO: validate listUrl
			list = localList;
		}
		listCache.set(listUrl, list);
		return list;
	} catch (error) {
		console.error(`Failed to load token list from ${listUrl}:`, error);
		throw error;
	}
};
