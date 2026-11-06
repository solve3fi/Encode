import { useMemo } from "react";
import type { PartnerSpaceView } from "@/configs/partnerSpaces";
import { GAUGE_STATUS_LABEL } from "@/lib/gaugeStatus";
import { gaugeVotingPower, votingPowerUnits } from "@/lib/voteDisplay";
import { useCluster } from "@/providers/ClusterProvider";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { useGaugelessPools } from "@/stores/admin/hooks/useGaugelessPools";
import { useVote } from "@/stores/vote/hooks/useVote";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";

export type PartnerPoolStatus = {
	loading: boolean;
	poolAddress: string | null;
	poolLabel: string | null;
	gaugeStatus: number | null;
	gaugeLabel: string;
	gaugeActive: boolean;
	/** This epoch's share of all votes on the partner's gauge, in percent; null when unknown. */
	voteSharePct: number | null;
	epoch: number | null;
};

/**
 * Where the partner's pool and gauge stand on-chain, from the same live data the rest of the app
 * reads. The pool is the one the admin recorded, or else the pool that trades the partner's token.
 */
export function usePartnerPoolStatus(
	space: Pick<PartnerSpaceView, "mint" | "poolAddress"> | null,
): PartnerPoolStatus {
	const { network } = useCluster();
	const { pools, isLoading } = useAdminPickers();
	const { gauges } = useGaugelessPools();
	const { data: voteConfig } = useVoteConfig(network);
	const epoch = voteConfig?.epoch.toNumber() ?? 0;
	const { data: snapshot } = useVote(network, epoch);

	return useMemo(() => {
		const pool = space
			? pools.find((p) =>
					space.poolAddress
						? p.address === space.poolAddress
						: p.mintA === space.mint || p.mintB === space.mint,
				)
			: undefined;
		const gauge = pool
			? gauges.find((g) => g.account.poolAddress.toString() === pool.address)
			: undefined;
		const status = gauge ? gauge.account.status : null;
		let share: number | null = null;
		if (gauge && snapshot) {
			const total = votingPowerUnits(snapshot.votes);
			share = total > 0 ? (votingPowerUnits(gaugeVotingPower(snapshot, gauge.publicKey)) / total) * 100 : 0;
		}
		return {
			loading: isLoading,
			poolAddress: pool?.address ?? null,
			poolLabel: pool?.label ?? null,
			gaugeStatus: status,
			gaugeLabel: status === null ? "No gauge yet" : (GAUGE_STATUS_LABEL[status] ?? "Unknown"),
			gaugeActive: status === 2,
			voteSharePct: share,
			epoch: epoch || null,
		};
	}, [space, pools, gauges, snapshot, isLoading, epoch]);
}
