import type { PublicKey } from "@solana/web3.js";
import { useCluster } from "@/providers/ClusterProvider";
import { useQuery } from "@tanstack/react-query";
import {
	getGaugePDA,
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "./useVesolveProgram";

/**
 * Whether a pool currently has an active gauge. Once active, its trading
 * fees route through the native-gauge emission stream instead of a pool's
 * own direct LP fee accrual — see useEmissionApr.ts for the reward side of
 * that same gauge lookup.
 */
export const usePoolGaugeStatus = (poolAddress: PublicKey | undefined) => {
	const program = useVesolveProgram();
	const { network } = useCluster();

	return useQuery({
		queryKey: ["pool-gauge-status", network, poolAddress?.toString()],
		queryFn: async (): Promise<{ isActive: boolean; status: number | null }> => {
			const [protocolAddress] = getProtocolPDA();
			const [gaugeAddress] = getGaugePDA(
				protocolAddress,
				poolAddress as PublicKey,
			);
			const gauge = await vesolveAccount
				.gauge(program)
				.fetchNullable(gaugeAddress);
			return { isActive: gauge?.isActive ?? false, status: gauge?.status ?? null };
		},
		enabled: !!poolAddress,
		staleTime: 30_000,
	});
};
