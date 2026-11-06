import { poll } from "@/lib/poll";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	EMPTY_LP_INCENTIVES_CONFIG,
	isActiveIncentive,
	type LpIncentivePool,
	type LpIncentivesConfig,
	type LpLedgerPublic,
} from "@/configs/lpIncentives";

export const LP_INCENTIVES_QUERY_KEY = ["lp-incentives-config"];
export const LP_LEDGER_QUERY_KEY = ["lp-incentives-ledger"];

/** Admin-configured incentive program (public read). */
export const useLpIncentivesConfig = () =>
	useQuery({
		queryKey: LP_INCENTIVES_QUERY_KEY,
		queryFn: async () => {
			const res = await fetch("/api/admin/lp-incentives");
			if (!res.ok) throw new Error("Failed to load LP incentives");
			return (await res.json()) as LpIncentivesConfig;
		},
		staleTime: 30_000,
		placeholderData: EMPTY_LP_INCENTIVES_CONFIG,
	});

/**
 * Keeper ledger summary; includes the connected wallet's credit when one is
 * connected (the endpoint only ever returns a single wallet's entry).
 */
export const useLpIncentiveLedger = () => {
	const { publicKey } = useWallet();
	const wallet = publicKey?.toBase58();
	return useQuery({
		queryKey: [...LP_LEDGER_QUERY_KEY, wallet ?? null],
		queryFn: async () => {
			const url = wallet
				? `/api/lp-incentives/ledger?wallet=${encodeURIComponent(wallet)}`
				: "/api/lp-incentives/ledger";
			const res = await fetch(url);
			if (!res.ok) throw new Error("Failed to load LP incentive ledger");
			return (await res.json()) as LpLedgerPublic;
		},
		staleTime: 30_000,
		refetchInterval: poll(60_000),
	});
};

export type LpIncentiveView = {
	config: LpIncentivePool;
	trailing7d: LpLedgerPublic["pools"][string]["trailing7d"] | null;
	lastSampleTs: number | null;
};

/** Active incentives keyed by pool address, joined with their ledger stats. */
export const useLpIncentives = () => {
	const config = useLpIncentivesConfig();
	const ledger = useLpIncentiveLedger();
	const veSolv3Usd = config.data?.veSolv3Usd ?? EMPTY_LP_INCENTIVES_CONFIG.veSolv3Usd;

	const pools = useMemo(() => {
		const map = new Map<string, LpIncentiveView>();
		for (const pool of Object.values(config.data?.pools ?? {})) {
			if (!isActiveIncentive(pool)) continue;
			const stats = ledger.data?.pools[pool.poolAddress];
			map.set(pool.poolAddress, {
				config: pool,
				trailing7d: stats?.trailing7d ?? null,
				lastSampleTs: stats?.lastSampleTs ?? null,
			});
		}
		return map;
	}, [config.data, ledger.data]);

	return {
		pools,
		veSolv3Usd,
		hasActive: pools.size > 0,
		wallet: ledger.data?.wallet ?? null,
		isLoading: config.isLoading || ledger.isLoading,
	};
};
