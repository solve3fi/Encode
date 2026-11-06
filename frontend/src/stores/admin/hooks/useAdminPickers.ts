import type { Solve } from "@solve3fi/sdk";
import { useMemo } from "react";
import { useAllPools } from "@/hooks/useAllPools";
import { usePools } from "@/hooks/usePools";
import { useTokens } from "@/hooks/useToken";
import { formatAddress, formatPercentage } from "@/lib/format";
import { GAUGE_STATUS } from "@/lib/gaugeStatus";
import { useGaugelessPools } from "./useGaugelessPools";

export type PickerOption = { value: string; label: string };

/**
 * Everything the admin forms need to offer instead of asking for a pasted address:
 * every live pool (with its token symbols, fee tier and gauge state) and every token
 * those pools trade.
 */
export const useAdminPickers = () => {
	const { data: allPools, isLoading: poolsLoading } = useAllPools();
	const { data: pools, isLoading: poolDataLoading } = usePools(allPools);
	const { gauges, isLoading: gaugesLoading } = useGaugelessPools();

	const mints = useMemo(
		() =>
			(pools ?? []).flatMap((pool: Solve) => [
				pool.getData().tokenMintA.toString(),
				pool.getData().tokenMintB.toString(),
			]),
		[pools],
	);
	const tokens = useTokens(mints);

	const gaugeStatusByPool = useMemo(() => {
		const map = new Map<string, number>();
		for (const gauge of gauges) map.set(gauge.account.poolAddress.toString(), gauge.account.status);
		return map;
	}, [gauges]);

	const pairs = useMemo(
		() =>
			(pools ?? []).map((pool: Solve, index: number) => {
				const address = pool.getAddress().toString();
				const data = pool.getData();
				const symbolA = tokens?.[index * 2]?.symbol ?? formatAddress(data.tokenMintA.toString());
				const symbolB = tokens?.[index * 2 + 1]?.symbol ?? formatAddress(data.tokenMintB.toString());
				const status = gaugeStatusByPool.get(address);
				return {
					address,
					status,
					mintA: data.tokenMintA.toString(),
					mintB: data.tokenMintB.toString(),
					label: `${symbolA}/${symbolB} · ${formatPercentage(data.feeRate / 10000)}`,
				};
			}),
		[pools, tokens, gaugeStatusByPool],
	);

	/** Every pool. */
	const poolOptions: PickerOption[] = useMemo(
		() => pairs.map((p) => ({ value: p.address, label: p.label })),
		[pairs],
	);
	/** Pools whose gauge is not active: the ones that pay a share of fees to the Treasury. */
	const ungaugedPoolOptions: PickerOption[] = useMemo(
		() =>
			pairs
				.filter((p) => p.status !== GAUGE_STATUS.active)
				.map((p) => ({ value: p.address, label: p.label })),
		[pairs],
	);
	/** Every distinct token traded by a live pool. */
	const tokenOptions: PickerOption[] = useMemo(() => {
		const seen = new Map<string, string>();
		mints.forEach((mint, index) => {
			if (!seen.has(mint)) {
				const token = tokens?.[index];
				seen.set(mint, `${token?.symbol ?? "Token"} · ${formatAddress(mint)}`);
			}
		});
		return [...seen.entries()].map(([value, label]) => ({ value, label }));
	}, [mints, tokens]);

	return {
		/** Every pool with its mints and gauge status (undefined = no gauge yet). */
		pools: pairs,
		poolOptions,
		ungaugedPoolOptions,
		tokenOptions,
		isLoading: poolsLoading || poolDataLoading || gaugesLoading,
	};
};
