import { DecimalUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import type { AddressLookupTableAccount } from "@solana/web3.js";
import {
	IGNORE_CACHE,
	type SolveRouter,
	type Trade,
	type TradeRoute,
} from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { useCluster } from "@/providers/ClusterProvider";
import { useWallet } from "@solana/wallet-adapter-react";
import { TradeState } from "@/stores/swap";
import { usePoolRouters } from "./usePoolRouters";

export type BestTrade = {
	router: SolveRouter | undefined;
	routers: TradeRoute | undefined;
	alts: AddressLookupTableAccount[] | undefined;
	state: TradeState;
	request?: Trade;
};

export const useBestTrade = (
	from: TokenInfo | undefined | null,
	to: TokenInfo | undefined | null,
	amount: number,
	isExactIn = true,
): BestTrade => {
	const { network } = useCluster();
	const { publicKey } = useWallet();
	const {
		router,
		routingOptions,
		selectionOptions,
		isLoading: poolRoutersLoading,
	} = usePoolRouters();
	const trade: Trade = {
		tokenIn: from?.address ?? "",
		tokenOut: to?.address ?? "",
		amountSpecifiedIsInput: isExactIn,
		tradeAmount: DecimalUtil.toBN(
			DecimalUtil.fromNumber(amount),
			(isExactIn ? from : to)?.decimals,
		),
	};

	const {
		data: bestRouter,
		isLoading: bestTradeLoading,
		isFetching,
		isError,
	} = useQuery({
		queryKey: ["bestTrade", network, from?.address, to?.address, amount, publicKey?.toString(), isExactIn],
		staleTime: 15_000,
		refetchInterval: 15_000,
		queryFn: async () =>
			(await router?.findBestRoute(
				trade,
				routingOptions,
				selectionOptions,
				IGNORE_CACHE,
			)) || null,

		enabled: !!router && !!amount && !!from && !!to,
	});

	const [routers, alts] = bestRouter || [];

	let state: TradeState;
	if (poolRoutersLoading || bestTradeLoading) {
		state = TradeState.LOADING;
	} else if (isError || !router) {
		state = TradeState.INVALID;
	} else if (!routers) {
		state = TradeState.NO_ROUTE_FOUND;
	} else if (isFetching) {
		state = TradeState.SYNCING;
	} else {
		state = TradeState.VALID;
	}

	return {
		router,
		routers,
		alts,
		state,
		request: trade,
	};
};
