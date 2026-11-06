import { useLingui } from "@lingui/react";
import { Button, Group, Select, Stack, Text } from "@mantine/core";
import type { Solve } from "@solve3fi/sdk";
import { useMemo, useState } from "react";
import { useTokens } from "@/hooks/useToken";
import { formatAddress, formatPercentage } from "@/lib/format";
import { pairHolderOf } from "@/lib/gaugeStatus";
import { useCreateGauge } from "@/stores/admin/hooks/useCreateGauge";
import { useGaugelessPools } from "@/stores/admin/hooks/useGaugelessPools";
import { CardLayout } from "../Layout/CardLayout";

export const AdminAddGauge: React.FC = () => {
	const { i18n } = useLingui();
	const { gaugelessPools, gauges, isLoading } = useGaugelessPools();
	const { mutate: createGauge, isPending } = useCreateGauge();

	const mintAddresses = useMemo(
		() =>
			gaugelessPools.flatMap((pool: Solve) => [
				pool.getData().tokenMintA.toString(),
				pool.getData().tokenMintB.toString(),
			]),
		[gaugelessPools],
	);
	const tokens = useTokens(mintAddresses);

	const options = useMemo(
		() =>
			gaugelessPools.map((pool: Solve, index: number) => {
				const tokenA = tokens?.[index * 2];
				const tokenB = tokens?.[index * 2 + 1];
				const address = pool.getAddress().toString();
				const symbolA = tokenA?.symbol ?? formatAddress(address);
				const symbolB = tokenB?.symbol ?? "?";
				// feeRate is in hundredths of a basis point (1,000,000 = 100%),
				// so /10000 gives a plain percent (3000 -> 0.3%, 10000 -> 1%).
				const feePercent = pool.getData().feeRate / 10000;
				const data = pool.getData();
				// One canonical gauge per token pair: when another fee tier of this pair already has one,
				// this pool's gauge is created inactive and "Move gauge to another pool" switches the pair to it.
				const taken = pairHolderOf(gauges, data.tokenMintA, data.tokenMintB);
				return {
					value: address,
					label: `${symbolA}/${symbolB} — ${formatPercentage(feePercent)} fee tier${
						taken
							? ` · ${i18n._("pair already has a gauge: will be created inactive")}`
							: ""
					}`,
				};
			}),
		[gaugelessPools, gauges, tokens, i18n],
	);

	const [selected, setSelected] = useState<string | null>(null);
	const selectedPool = gaugelessPools.find(
		(pool: Solve) => pool.getAddress().toString() === selected,
	);

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Add Pool to Gauge")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Without an active gauge, LPs earn 95% of trading fees (5% goes to the Treasury) and no emissions. With an active gauge, 100% of trading fees go to its voters and in-range LPs share its weekly emissions, weighted by liquidity. Previously earned rewards stay claimable.",
					)}
				</Text>
				<Text fz="xs" c="dimmed">
					{i18n._("Use the protocol Admin wallet. This creates the gauge and schedules its activation in one transaction; it switches on from the start of the next epoch (run the switch from Gauge status).")}
				</Text>
				<Select
					placeholder={
						isLoading
							? i18n._("Loading pools…")
							: options.length === 0
								? i18n._("No pools without a gauge")
								: i18n._("Select a pool")
					}
					data={options}
					value={selected}
					onChange={setSelected}
					searchable
					disabled={isLoading || options.length === 0}
				/>
				<Group justify="flex-end">
					<Button
						loading={isPending}
						disabled={!selectedPool}
						onClick={() => {
							if (!selectedPool) return;
							const data = selectedPool.getData();
							createGauge({
								poolAddress: selectedPool.getAddress(),
								tokenMintA: data.tokenMintA,
								tokenMintB: data.tokenMintB,
								tickSpacing: data.tickSpacing,
							});
							setSelected(null);
						}}
					>
						{i18n._("Add to Gauge")}
					</Button>
				</Group>
			</Stack>
		</CardLayout>
	);
};
