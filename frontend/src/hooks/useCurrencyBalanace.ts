import { poll } from "@/lib/poll";
import { AddressUtil, DecimalUtil, TokenUtil } from "@solve3fi/common";
import {
	AccountLayout,
	getAccount,
	getAssociatedTokenAddress,
	TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import BN from "bn.js";
import { useAnchor } from "@/providers/DappProvider";
import { queryClient } from "@/providers/QueryProvider";
import { useNativeBalance } from "./useNativeBalance";

export interface TokenBalance {
	[token: string]: BN;
}

export const useTokenBalance = (token?: string) => {
	const { connection, publicKey } = useAnchor();
	return useQuery({
		queryKey: ["token-balance", publicKey?.toBase58(), token],
		queryFn: async () => {
			if (!token) return new BN(0);
			const tokenAccount = await getAssociatedTokenAddress(
				new PublicKey(token),
				publicKey,
			);
			const accountInfo = await getAccount(connection, tokenAccount);
			return new BN(accountInfo.amount.toString());
		},
		enabled: !!token && !!publicKey,
		refetchInterval: poll(1000 * 60),
		refetchIntervalInBackground: true,
	});
};

export const useAllTokenBalances = () => {
	const { connection, publicKey } = useAnchor();
	const { data: nativeBalance } = useNativeBalance();
	return useQuery({
		queryKey: ["token-balances", publicKey?.toBase58()],
		queryFn: async () =>
			await connection.getTokenAccountsByOwner(publicKey, {
				programId: TOKEN_PROGRAM_ID,
			}),

		select(data) {
			return data.value.reduce((acc, item) => {
				const accountInfo = AccountLayout.decode(item.account.data);
				if (TokenUtil.isNativeMint(AddressUtil.toPubKey(accountInfo.mint))) {
					acc[accountInfo.mint.toBase58()] = new BN(nativeBalance || 0);
					return acc;
				}

				const tokenAmount = new BN(accountInfo.amount.toString());
				acc[accountInfo.mint.toBase58()] = tokenAmount;

				queryClient.setQueryData(
					["token-balance", publicKey?.toBase58(), accountInfo.mint.toBase58()],
					tokenAmount,
				);

				return acc;
			}, {} as TokenBalance);
		},
		enabled: !!publicKey,
	});
};

export const useCurrencyBalances = (currencies: (TokenInfo | undefined)[]) => {
	const { data: tokenBalances } = useAllTokenBalances();
	const { data: nativeBalance } = useNativeBalance();

	const currenciesBalance = currencies?.map((currency) => {
		if (!currency) return undefined;
		if (TokenUtil.isNativeMint(AddressUtil.toPubKey(currency.address))) {
			return DecimalUtil.fromNumber(nativeBalance || 0);
		}

		return DecimalUtil.fromBN(
			tokenBalances?.[currency.address] ?? new BN(0),
			currency.decimals,
		);
	});

	return currenciesBalance;
};
