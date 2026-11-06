import { useQuery } from "@tanstack/react-query";
import type { AcceleratorPartnersById } from "@/configs/acceleratorProgram";
import type { ClusterNetwork } from "@/providers/ClusterProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";

export type AcceleratedPoolInfo = {
	projectName: string;
	epochsRemaining: number;
};

// A pool counts as currently boosted only while its accelerator enrollment
// is both marked "active" AND still within its epoch window — a partner
// that hit its max epochs is no longer boosted even if nobody remembered to
// click "Mark completed" in the Admin page, matching "remove the icon when
// they are no longer boosted" rather than requiring a manual admin step.
export const useAcceleratedPools = (
	network: ClusterNetwork,
): Map<string, AcceleratedPoolInfo> => {
	const { data: voteConfig } = useVoteConfig(network);
	const currentEpoch = voteConfig?.epoch.toNumber() || 0;

	const { data: partners } = useQuery({
		queryKey: ["accelerator-partners-public"],
		queryFn: async () => {
			const res = await fetch("/api/admin/accelerator-partners");
			if (!res.ok) throw new Error("Failed to load");
			return res.json() as Promise<AcceleratorPartnersById>;
		},
		staleTime: 30_000,
	});

	const result = new Map<string, AcceleratedPoolInfo>();
	if (!partners || currentEpoch <= 0) return result;

	for (const partner of Object.values(partners)) {
		if (partner.status !== "active") continue;
		const epochsRemaining =
			partner.maxEpochs - (currentEpoch - partner.enrolledAtEpoch);
		if (epochsRemaining <= 0) continue;
		result.set(partner.poolAddress, {
			projectName: partner.projectName,
			epochsRemaining,
		});
	}

	return result;
};
