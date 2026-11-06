import { PDAUtil } from "@solve3fi/sdk";
import { useQuery } from "@tanstack/react-query";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { useCluster } from "@/providers/ClusterProvider";
import { useAnchor } from "@/providers/DappProvider";
import { TICK_SPACINGS } from "@/stores/pool";

/**
 * Tick spacings whose fee-tier account exists on this deployment. A pool can only
 * be created on a tier the protocol admin has initialised; the SDK otherwise fails
 * with an opaque "Invariant failed".
 */
export const useEnabledFeeTiers = () => {
	const { network } = useCluster();
	const { connection } = useAnchor();
	return useQuery({
		queryKey: ["enabled-fee-tiers", network],
		staleTime: 60_000,
		queryFn: async () => {
			const spacings = [...new Set(Object.values(TICK_SPACINGS))];
			const addresses = spacings.map(
				(spacing) =>
					PDAUtil.getFeeTier(
						DEX_PROGRAM_ID[network],
						PROGRAM_CONFIG[network],
						spacing,
					).publicKey,
			);
			const infos = await connection.getMultipleAccountsInfo(addresses);
			return new Set(spacings.filter((_, i) => infos[i] !== null));
		},
	});
};
