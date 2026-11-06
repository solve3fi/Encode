import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { PartnerSpaceStatus_ } from "@/configs/partnerSpaces";
import type { TokenRequest, TokenRequestsById } from "@/configs/tokenRequests";
import {
	countNeedingAction,
	type OnboardingResult,
	onboardingProgress,
} from "@/lib/partnerOnboarding";
import { PARTNER_VOTER } from "@/configs/partnerVoter";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { usePartnerVoters } from "./usePartnerVoters";

export type OnboardingRow = {
	mint: string;
	symbol: string;
	name: string;
	submittedAt: number;
	poolLabel: string | null;
	progress: OnboardingResult;
	space: PartnerSpaceStatus_ | null;
};

/**
 * One row per token listing request with where it stands on the way to a partner space. Reads only
 * public, non-secret data (requests, pools and gauges on-chain, and which listings already have a
 * space), so it loads without an admin signature. Admin-only.
 */
export function usePartnerOnboarding() {
	const { pools } = useAdminPickers();
	const requests = useQuery({
		queryKey: ["partner-onboarding-requests"],
		refetchInterval: 60_000,
		queryFn: async () => {
			const res = await fetch("/api/admin/token-requests", { cache: "no-store" });
			if (!res.ok) throw new Error("Could not load token requests");
			return (await res.json()) as TokenRequestsById;
		},
	});
	// The shared partner voter is flagged once for every partner; unknown while it loads or when none is configured.
	const voters = usePartnerVoters();
	const partnerVoterFlagged =
		!PARTNER_VOTER || voters.isLoading
			? undefined
			: (voters.data ?? []).some((entry) => entry.voter === PARTNER_VOTER?.toBase58());
	// Accelerator enrollments are public (keyed by pool address).
	const accelerator = useQuery({
		queryKey: ["partner-onboarding-accelerator"],
		refetchInterval: 60_000,
		queryFn: async () => {
			const res = await fetch("/api/admin/accelerator-partners", { cache: "no-store" });
			if (!res.ok) throw new Error("Could not load Accelerator partners");
			return (await res.json()) as Record<string, { status: string }>;
		},
	});
	const spaces = useQuery({
		queryKey: ["partner-onboarding-spaces"],
		refetchInterval: 60_000,
		queryFn: async () => {
			const res = await fetch("/api/admin/partner-spaces/status", { cache: "no-store" });
			if (!res.ok) throw new Error("Could not load partner spaces");
			return ((await res.json()) as { spaces: PartnerSpaceStatus_[] }).spaces;
		},
	});

	const rows = useMemo<OnboardingRow[]>(() => {
		const byMint = new Map<string, PartnerSpaceStatus_>();
		// An active space wins over a revoked one for the same listing.
		for (const space of spaces.data ?? [])
			if (!byMint.has(space.mint) || space.status === "active") byMint.set(space.mint, space);
		return Object.values(requests.data ?? {})
			.sort((a: TokenRequest, b: TokenRequest) => b.submittedAt - a.submittedAt)
			.map((request) => {
				const poolsOfMint = pools.filter((p) => p.mintA === request.mint || p.mintB === request.mint);
				// A token can have several pools (one per fee tier); the one that matters is the one with the gauge.
				const pool =
					poolsOfMint.find((p) => p.status === 2) ?? poolsOfMint.find((p) => p.status !== undefined) ?? poolsOfMint[0];
				const space = byMint.get(request.mint) ?? null;
				const gauged = poolsOfMint.filter((p) => p.status !== undefined);
				const spacePoolOk = space && gauged.length > 0 ? gauged.some((p) => p.address === space.poolAddress) : undefined;
				const acceleratorEnrolled = accelerator.data
					? poolsOfMint.some((p) => {
							const entry = accelerator.data?.[p.address];
							return Boolean(entry) && entry?.status !== "removed";
						})
					: undefined;
				return {
					mint: request.mint,
					symbol: request.symbol,
					name: request.name,
					submittedAt: request.submittedAt,
					poolLabel: pool?.label ?? null,
					space,
					progress: onboardingProgress({
						requestStatus: request.status,
						pool: pool ? { gaugeStatus: pool.status } : null,
						space: space
							? { status: space.status, walletCount: space.walletCount, linkSentAt: space.linkSentAt }
							: null,
						spacePoolOk,
						partnerVoterFlagged,
						accelerator: acceleratorEnrolled,
					}),
				};
			});
	}, [requests.data, spaces.data, pools, partnerVoterFlagged, accelerator.data]);

	return {
		rows,
		actionCount: countNeedingAction(rows.map((r) => r.progress)),
		isLoading: requests.isLoading || spaces.isLoading,
		error: requests.error ?? spaces.error,
		refetch: () => {
			void requests.refetch();
			void spaces.refetch();
		},
	};
}
