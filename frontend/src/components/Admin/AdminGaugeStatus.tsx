import { useLingui } from "@lingui/react";
import { Button, Group, Select, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useTokens } from "@/hooks/useToken";
import {
	getProtocolPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { formatAddress } from "@/lib/format";
import { GAUGE_STATUS, GAUGE_STATUS_LABEL, isDue } from "@/lib/gaugeStatus";
import { nativeGaugeAddresses } from "@/lib/nativeGaugeAccounts";
import { useCluster } from "@/providers/ClusterProvider";
import { useConfigureNativeGauge } from "@/stores/admin/hooks/useConfigureNativeGauge";
import { useGaugeLifecycle } from "@/stores/admin/hooks/useGaugeLifecycle";
import { useGaugelessPools } from "@/stores/admin/hooks/useGaugelessPools";
import { CardLayout } from "../Layout/CardLayout";

export function AdminGaugeStatus() {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const program = useVesolveProgram();
	const { gauges, isLoading, error } = useGaugelessPools();
	const [selected, setSelected] = useState<string | null>(null);
	const gauge = gauges.find((item) => item.publicKey.toString() === selected);
	const mints = useMemo(
		() =>
			gauges.flatMap((item) => [
				item.account.tokenMintA.toString(),
				item.account.tokenMintB.toString(),
			]),
		[gauges],
	);
	const tokens = useTokens(mints);
	const native = useQuery({
		queryKey: ["vesolve-native-gauges", network, selected],
		enabled: !!gauge,
		queryFn: async () =>
			gauge
				? vesolveAccount
						.nativeGauge(program)
						.fetchNullable(
							nativeGaugeAddresses(
								program.programId,
								DEX_PROGRAM_ID[network],
								gauge.publicKey,
								gauge.account.poolAddress,
							).nativeGauge,
						)
				: null,
		refetchInterval: 15_000,
	});
	const mutation = useConfigureNativeGauge();
	const lifecycle = useGaugeLifecycle();
	const protocol = useQuery({
		// Not "vesolve-protocol": useVoteConfig caches a differently shaped value there.
		queryKey: ["vesolve-protocol-account", network],
		queryFn: async () =>
			vesolveAccount.protocol(program).fetch(getProtocolPDA()[0]),
		refetchInterval: 15_000,
	});
	const currentEpoch = protocol.data?.currentEpoch.toNumber() ?? 0;
	const options = gauges.map((item, index) => ({
		value: item.publicKey.toString(),
		label: `${tokens?.[index * 2]?.symbol ?? formatAddress(item.account.tokenMintA.toString())}/${tokens?.[index * 2 + 1]?.symbol ?? formatAddress(item.account.tokenMintB.toString())} · ${GAUGE_STATUS_LABEL[item.account.status] ?? "Unknown"}`,
	}));
	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Gauge status")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Pausing a gauge returns future trading fees to LPs and stops new emissions. Earned fees and rewards stay claimable.",
					)}
				</Text>
				<Select
					label={i18n._("Pool gauge")}
					placeholder={i18n._("Select a gauge")}
					data={options}
					searchable
					value={selected}
					onChange={setSelected}
					disabled={isLoading || mutation.isPending}
				/>
				{error || native.error ? (
					<Text c="red" size="sm">
						{i18n._(
							"Gauge state could not be read. Refresh before changing it.",
						)}
					</Text>
				) : null}
				{gauge ? (
					<GaugeActions
						status={gauge.account.status}
						effectiveEpoch={gauge.account.effectiveEpoch.toNumber()}
						currentEpoch={currentEpoch}
						nativeReady={!native.isLoading && !native.error && !error}
						poolAddress={gauge.account.poolAddress.toString()}
						busy={mutation.isPending || lifecycle.isPending}
						onSchedule={() =>
							lifecycle.mutate({
								kind: "schedule",
								poolAddress: gauge.account.poolAddress.toString(),
							})
						}
						onRemove={() =>
							lifecycle.mutate({
								kind: "remove",
								poolAddress: gauge.account.poolAddress.toString(),
							})
						}
						onExecute={(active) =>
							mutation.mutate({
								poolAddress: gauge.account.poolAddress.toString(),
								active,
							})
						}
					/>
				) : null}
			</Stack>
		</CardLayout>
	);
}

function GaugeActions({
	status,
	effectiveEpoch,
	currentEpoch,
	nativeReady,
	busy,
	onSchedule,
	onRemove,
	onExecute,
}: {
	status: number;
	effectiveEpoch: number;
	currentEpoch: number;
	nativeReady: boolean;
	poolAddress: string;
	busy: boolean;
	onSchedule: () => void;
	onRemove: () => void;
	onExecute: (active: boolean) => void;
}) {
	const { i18n } = useLingui();
	const due = isDue(effectiveEpoch, currentEpoch);
	const pending =
		status === GAUGE_STATUS.pendingActivation ||
		status === GAUGE_STATUS.pendingRemoval;
	return (
		<Group justify="space-between" align="center" wrap="wrap">
			<Text size="sm" c="dimmed">
				{pending
					? due
						? i18n._(
								"Scheduled change is due: run it to switch fees and emissions.",
							)
						: i18n._("Takes effect at the start of epoch {epoch}.", {
								epoch: effectiveEpoch,
							})
					: status === GAUGE_STATUS.active
						? i18n._("Active: fees to voters, emissions to in-range LPs")
						: i18n._("Not active: fees to LPs, no emissions")}
			</Text>
			<Group>
				{status === GAUGE_STATUS.created || status === GAUGE_STATUS.removed ? (
					<Button disabled={busy} onClick={onSchedule}>
						{i18n._("Schedule activation")}
					</Button>
				) : null}
				{status === GAUGE_STATUS.active ? (
					<Button
						color="gray"
						variant="light"
						disabled={busy}
						onClick={onRemove}
					>
						{i18n._("Request removal")}
					</Button>
				) : null}
				{pending ? (
					<Button
						disabled={busy || !due || !nativeReady}
						onClick={() => onExecute(status === GAUGE_STATUS.pendingActivation)}
					>
						{status === GAUGE_STATUS.pendingActivation
							? i18n._("Switch on")
							: i18n._("Complete removal")}
					</Button>
				) : null}
			</Group>
		</Group>
	);
}
