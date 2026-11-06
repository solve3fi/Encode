import type { Solve } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAllPools } from "@/hooks/useAllPools";
import { usePools } from "@/hooks/usePools";
import { useVesolveProgram, vesolveAccount } from "@/hooks/useVesolveProgram";
import { useCluster } from "@/providers/ClusterProvider";

/**
 * Every existing Solve pool that doesn't have a vesolve Gauge yet — the
 * candidate list for the admin "add pool to gauge" picker.
 */
export const useGaugelessPools = () => {
	const program = useVesolveProgram();
	const { network } = useCluster();
	const { data: allPools, isLoading: poolsLoading } = useAllPools();
	const { data: pools, isLoading: poolDataLoading } = usePools(allPools);

	const gaugesQuery = useQuery({
		queryKey: ["vesolve-all-gauges", network],
		queryFn: async () => vesolveAccount.gauge(program).all(),
		refetchInterval: 15_000,
	});

	const gaugedPoolAddresses = useMemo(
		() =>
			new Set(
				(gaugesQuery.data ?? []).map((g) => g.account.poolAddress.toString()),
			),
		[gaugesQuery.data],
	);

	const gaugelessPools = useMemo(
		() =>
			(pools ?? []).filter(
				(pool: Solve) => !gaugedPoolAddresses.has(pool.getAddress().toString()),
			),
		[pools, gaugedPoolAddresses],
	);

	return {
		gauges: gaugesQuery.data ?? [],
		error: gaugesQuery.error,
		gaugelessPools,
		gaugedPoolAddresses,
		isLoading: poolsLoading || poolDataLoading || gaugesQuery.isLoading,
	};
};
