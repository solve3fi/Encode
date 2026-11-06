import {
	RouterUtils,
	type RouteSelectOptions,
	type RoutingOptions,
	SolveRouterBuilder,
} from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import {
	GENESIS_PUBLIC_ENABLED,
	isGenesisRestrictedTokenMint,
} from "@/configs/genesis";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { useAllPools } from "./useAllPools";
import { usePools } from "./usePools";

export const usePoolRouters = (enabled = true) => {
	const { network } = useCluster();
	const { ctx } = useClient(DEX_PROGRAM_ID[network]);
	const { data: addresses, isLoading: accountsLoading } = useAllPools();
	const { data: genesisPools, isLoading: genesisPoolsLoading } = usePools(
		GENESIS_PUBLIC_ENABLED ? addresses : undefined,
	);
	const routableAddresses = GENESIS_PUBLIC_ENABLED
		? genesisPools
				?.filter((pool) => {
					const data = pool.getData();
					return !(
						isGenesisRestrictedTokenMint(data.tokenMintA.toString()) ||
						isGenesisRestrictedTokenMint(data.tokenMintB.toString())
					);
				})
				.map((pool) => pool.getAddress().toString())
		: addresses;

	const { data: router, isLoading: routerLoading } = useQuery({
		queryKey: [
			"poolRouter",
			network,
			routableAddresses?.join("-"),
			ctx.wallet.publicKey?.toString(),
		],
		queryFn: async () =>
			SolveRouterBuilder.buildWithPools(ctx, routableAddresses ?? []),
		enabled: enabled && !!network && !!routableAddresses?.length,
	});

	const routingOptions: RoutingOptions = {
		...RouterUtils.getDefaultRouteOptions(),
	};

	const selectionOptions: RouteSelectOptions = {
		...RouterUtils.getDefaultRouteOptions(),
		maxSupportedTransactionVersion:
			ctx.txBuilderOpts?.defaultBuildOption.maxSupportedTransactionVersion ||
			"legacy",
		availableAtaAccounts: undefined,
		maxTransactionSize: 1232,
	};

	return {
		router,
		routingOptions,
		selectionOptions,
		isLoading:
			accountsLoading ||
			(GENESIS_PUBLIC_ENABLED && genesisPoolsLoading) ||
			routerLoading,
	};
};
