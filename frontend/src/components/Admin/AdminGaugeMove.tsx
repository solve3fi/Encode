import { Button, Checkbox, Select, Stack, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import { GAUGE_STATUS, GAUGE_STATUS_LABEL } from "@/lib/gaugeStatus";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { useGaugeLifecycle } from "@/stores/admin/hooks/useGaugeLifecycle";
import { useGaugelessPools } from "@/stores/admin/hooks/useGaugelessPools";
import { CardLayout } from "../Layout/CardLayout";

const samePair = (aMint: string, bMint: string, cMint: string, dMint: string) =>
	(aMint === cMint && bMint === dMint) || (aMint === dMint && bMint === cMint);

/**
 * Moves a token pair's one canonical gauge from one pool to another (for example a partner's 5% pool to their
 * 1% pool) in a single scheduled step. The old gauge goes to pending removal and the new one to pending
 * activation, both effective at the next epoch, so the pair never has two active gauges.
 */
export function AdminGaugeMove() {
	const { gauges } = useGaugelessPools();
	const { pools } = useAdminPickers();
	const lifecycle = useGaugeLifecycle();
	const [oldPool, setOldPool] = useState<string | null>(null);
	const [newPool, setNewPool] = useState<string | null>(null);
	const [confirmed, setConfirmed] = useState(false);

	const label = (poolAddress: string) =>
		pools.find((pool) => pool.address === poolAddress)?.label ?? poolAddress;

	const activeGauges = useMemo(
		() =>
			gauges.filter((gauge) => gauge.account.status === GAUGE_STATUS.active),
		[gauges],
	);
	const oldGauge = activeGauges.find(
		(g) => g.account.poolAddress.toBase58() === oldPool,
	);

	const targets = useMemo(() => {
		if (!oldGauge)
			return { ready: [], missing: [] as string[], blocked: [] as string[] };
		const a = oldGauge.account.tokenMintA.toBase58();
		const b = oldGauge.account.tokenMintB.toBase58();
		const ready: { value: string; label: string }[] = [];
		const missing: string[] = [];
		const blocked: string[] = [];
		for (const pool of pools) {
			if (pool.address === oldPool || !samePair(a, b, pool.mintA, pool.mintB))
				continue;
			const gauge = gauges.find(
				(g) => g.account.poolAddress.toBase58() === pool.address,
			);
			if (!gauge) missing.push(pool.label);
			else if (
				gauge.account.status === GAUGE_STATUS.created ||
				gauge.account.status === GAUGE_STATUS.removed
			)
				ready.push({ value: pool.address, label: pool.label });
			else
				blocked.push(
					`${pool.label} (${GAUGE_STATUS_LABEL[gauge.account.status] ?? "unknown"})`,
				);
		}
		return { ready, missing, blocked };
	}, [oldGauge, oldPool, pools, gauges]);

	const options = activeGauges.map((gauge) => ({
		value: gauge.account.poolAddress.toBase58(),
		label: label(gauge.account.poolAddress.toBase58()),
	}));

	const submit = () => {
		if (!oldPool || !newPool) return;
		lifecycle.mutate(
			{ kind: "migrate", oldPoolAddress: oldPool, newPoolAddress: newPool },
			{
				onSuccess: () => {
					setConfirmed(false);
					setNewPool(null);
				},
			},
		);
	};

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					Move gauge to another pool
				</Text>
				<Text fz="sm" c="gray">
					Use this when a project changes the pool it wants rewarded (for
					example from its 5% pool to its 1% pool). The contract always makes the
					switch at the next epoch, so it cannot be instant. But the moment you
					schedule it, the old gauge stops taking new votes and bribes and the
					new gauge starts taking votes (it takes bribes once it is active at the
					next epoch). Votes already cast on the old gauge stay with it. Fees and
					emissions move at the next epoch, so the pair never has two active gauges.
					</Text>
				<Select
					label="Active gauge to move away from"
					placeholder="Select an active gauge"
					data={options}
					searchable
					value={oldPool}
					onChange={(value) => {
						setOldPool(value);
						setNewPool(null);
						setConfirmed(false);
					}}
					disabled={lifecycle.isPending}
				/>
				{oldGauge ? (
					<>
						<Select
							label="Move it to"
							placeholder={
								targets.ready.length > 0
									? "Select the new pool"
									: "No pool with a ready gauge for this pair"
							}
							data={targets.ready}
							value={newPool}
							onChange={(value) => {
								setNewPool(value);
								setConfirmed(false);
							}}
							disabled={lifecycle.isPending || targets.ready.length === 0}
						/>
						{targets.missing.length > 0 ? (
							<Text fz="sm" c="yellow">
								These pools of the same pair have no gauge yet:{" "}
								{targets.missing.join(", ")}. Create one in Add gauge above,
								then come back.
							</Text>
						) : null}
						{targets.blocked.length > 0 ? (
							<Text fz="sm" c="dimmed">
								Not available as a target: {targets.blocked.join(", ")}.
							</Text>
						) : null}
					</>
				) : null}
				{oldPool && newPool ? (
					<Stack gap="xs">
						<Text fz="sm">
							<b>{label(oldPool)}</b> loses its gauge and{" "}
							<b>{label(newPool)}</b> gets it, both at the next epoch. After the
							epoch starts, run <b>Complete removal</b> on the old gauge and{" "}
							<b>Switch on</b> on the new one in Gauge status below. Any partner
							space pointing at the old pool must be moved too (Partner spaces).
						</Text>
						<Checkbox
							checked={confirmed}
							onChange={(event) => setConfirmed(event.currentTarget.checked)}
							label="I understand fees and emissions switch pools at the next epoch."
						/>
						<Button
							disabled={!confirmed || lifecycle.isPending}
							loading={lifecycle.isPending}
							onClick={submit}
						>
							Schedule the move
						</Button>
					</Stack>
				) : null}
			</Stack>
		</CardLayout>
	);
}
