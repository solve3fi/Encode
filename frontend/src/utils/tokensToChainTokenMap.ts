import type { TokenInfo, TokenList } from "@solana/spl-token-registry";

type TokenMap = Readonly<{
	[tokenAddress: string]: { token: TokenInfo; list?: TokenList };
}>;
export type TokenAddressMap = Readonly<{ [chainId: number]: TokenMap }>;

export type Mutable<T> = {
	-readonly [P in keyof T]: Mutable<T[P]>;
};

const mapCache =
	typeof WeakMap !== "undefined"
		? new WeakMap<TokenList | TokenInfo[], TokenAddressMap>()
		: null;

export function tokensToChainTokenMap(
	tokens: TokenList | TokenInfo[],
): TokenAddressMap {
	const cached = mapCache?.get(tokens);
	if (cached) return cached;

	const [list, infos] = Array.isArray(tokens)
		? [undefined, tokens]
		: [tokens, tokens.tokens];
	const map = infos.reduce<Mutable<TokenAddressMap>>((map, info) => {
		try {
			const token = info;
			if (map[token.chainId]?.[token.address] !== undefined) {
				console.warn(`Duplicate token skipped: ${token.address}`);
				return map;
			}
			if (!map[token.chainId]) {
				map[token.chainId] = {};
			}
			map[token.chainId][token.address] = { token, list };
			return map;
		} catch {
			return map;
		}
	}, {}) as TokenAddressMap;
	mapCache?.set(tokens, map);
	return map;
}
