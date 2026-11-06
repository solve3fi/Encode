import { poll } from "@/lib/poll";
import { DecimalUtil } from "@solve3fi/common";
import { IGNORE_CACHE } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { DEVNET_USDC, USDC } from "@/configs/tokens";
import { valueTokenAmounts } from "@/lib/devnetPricing";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { useDevnetPrices } from "./useDevnetPrices";
import { usePoolRouters } from "./usePoolRouters";
import { useAllTokens } from "./useToken";

export const useUSDCPrice = (addresses: Record<string, number>) => {
	const { network, cluster } = useCluster();
	const isDevnet = network === ClusterNetwork.Devnet;
	const stable = isDevnet ? DEVNET_USDC : USDC;
	const tokens = useAllTokens();
	const devnet = useDevnetPrices();
	const { router, routingOptions, selectionOptions, isLoading: routerLoading } = usePoolRouters(!isDevnet);
	const requestedMints = Object.keys(addresses).filter((mint) => addresses[mint] > 0).sort();
	const routedTokens = requestedMints.filter((mint) => mint !== stable.address)
		.map((mint) => tokens[mint]).filter(Boolean);
	const market = useQuery({
		queryKey: ["usdcTokenPrices", network, cluster.endpoint, routedTokens.map((token) => token.address + ":" + token.decimals).join(","), !!router],
		enabled: !isDevnet && !!router && !routerLoading && routedTokens.length > 0,
		queryFn: async () => {
			const prices = new Map<string, Decimal>();
			for (let index = 0; index < routedTokens.length; index += 5) {
				await Promise.all(routedTokens.slice(index, index + 5).map(async (token) => {
					try {
						const input = Decimal.max(0.001, new Decimal(10).pow(-token.decimals));
						const route = await router!.findBestRoute({
							tokenIn: token.address, tokenOut: stable.address,
							amountSpecifiedIsInput: true, tradeAmount: DecimalUtil.toBN(input, token.decimals),
						}, routingOptions, selectionOptions, IGNORE_CACHE);
						if (!route) return;
						const price = DecimalUtil.fromBN(route[0].totalAmountOut, stable.decimals).div(input);
						if (price.isFinite() && price.gt(0)) prices.set(token.address, price);
					} catch { /* Missing market prices are unavailable, not zero. */ }
				}));
			}
			return prices;
		},
		staleTime: 30_000,
		refetchInterval: poll(30_000),
	});

	// The peg works even before pools, token lists, RPC, or router readiness.
	// Devnet valuations are pool spot estimates, not executable swap quotes.
	const prices = new Map(isDevnet ? devnet.data?.prices : market.data);
	prices.set(stable.address, new Decimal(1));
	const valuation = valueTokenAmounts(addresses, prices);
	const breakdown = requestedMints.flatMap((address) => {
		const price = prices.get(address);
		if (!price) return [];
		return [{ address, symbol: tokens[address]?.symbol ?? address, price: price.toNumber(),
			amount: addresses[address], usdcValue: price.mul(addresses[address]), decimals: tokens[address]?.decimals ?? 0 }];
	});
	const needsMarket = requestedMints.some((mint) => mint !== stable.address);
	return {
		totalUsdcValue: valuation.total,
		breakdown,
		isComplete: valuation.isComplete,
		isLoading: needsMarket && (isDevnet ? devnet.isLoading : routerLoading || market.isLoading),
		isError: needsMarket && (isDevnet ? devnet.isError : market.isError),
		error: isDevnet ? devnet.error : market.error,
		refetch: isDevnet ? devnet.refetch : market.refetch,
	};
};
