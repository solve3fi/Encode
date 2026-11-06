"use client";

import { useLingui } from "@lingui/react";
import { Button, Group, NumberInput, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useSetExitFee } from "@/stores/admin/hooks/useSetExitFee";
import { effectiveExitFeeBps, useExitFeeConfig } from "@/stores/lock/hooks/useExitFeeConfig";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { CardLayout } from "../Layout/CardLayout";

const pct = (bps: number) => `${bps / 100}%`;

export const AdminExitFee: React.FC = () => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { data: feeConfig, isLoading } = useExitFeeConfig();
	const { data: voteConfig } = useVoteConfig(network ?? ClusterNetwork.Devnet);
	const setExitFee = useSetExitFee();
	const [percent, setPercent] = useState<number | string>("");

	const typed = typeof percent === "number" ? percent : Number(percent);
	const feeBps = percent === "" || Number.isNaN(typed) ? null : Math.round(typed * 100);
	const valid = feeBps !== null && feeBps >= 0 && feeBps <= 10_000;

	const epoch = voteConfig ? voteConfig.epoch.toNumber() : null;
	const inForce = feeConfig && epoch !== null ? effectiveExitFeeBps(feeConfig, epoch) : feeConfig?.feeBps;
	const hasPending =
		feeConfig && epoch !== null && feeConfig.pendingEpoch !== 0 && epoch < feeConfig.pendingEpoch;

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Exit Fee")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"The percentage of an exited position's market value charged in SOL. A change never applies to the current epoch; it starts with the next one.",
					)}
				</Text>
				<Group gap="sm">
					<Text c="gray" fz="sm">
						{i18n._("In force now")}:
					</Text>
					<Text fw={600}>
						{isLoading || inForce === undefined ? i18n._("Loading…") : pct(inForce)}
					</Text>
				</Group>
				{feeConfig && hasPending ? (
					<Text fz="sm">
						{i18n._("Scheduled")}: {pct(feeConfig.pendingBps)} {i18n._("from epoch")}{" "}
						{feeConfig.pendingEpoch}
					</Text>
				) : null}
				<Group align="flex-end" gap="sm" wrap="wrap">
					<NumberInput
						label={i18n._("New fee (%)")}
						placeholder="40"
						min={0}
						max={100}
						decimalScale={2}
						value={percent}
						onChange={setPercent}
						flex={1}
						miw={220}
					/>
					<Button
						loading={setExitFee.isPending}
						disabled={!valid}
						onClick={() => {
							if (feeBps === null || !valid) return;
							setExitFee.mutate({ feeBps });
							setPercent("");
						}}
					>
						{i18n._("Schedule fee")}
					</Button>
				</Group>
			</Stack>
		</CardLayout>
	);
};
