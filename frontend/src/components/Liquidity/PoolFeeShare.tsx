"use client";

import { useLingui } from "@lingui/react";
import { Text, Tooltip } from "@mantine/core";
import type { Solve } from "@solve3fi/sdk";
import Link from "next/link";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { DEX_ONLY } from "@/configs/launchPhase";
import { usePoolGaugeStatus } from "@/hooks/usePoolGaugeStatus";
import { useLpIncentives } from "@/hooks/useLpIncentives";

export type PoolFeeShareProps = {
	pool: Solve;
};

// Read straight off the pool account so it can never disagree with chain
// state: protocolFeeRate is the share of each swap fee the protocol keeps
// (bps of 10_000); the rest goes to LPs.
export const PoolFeeShare: React.FC<PoolFeeShareProps> = ({ pool }) => {
	const { i18n } = useLingui();
	const { pools } = useLpIncentives();
	const governanceOpen = !DEX_ONLY && !GENESIS_PUBLIC_ENABLED;
	const gauge = usePoolGaugeStatus(governanceOpen ? pool.getAddress() : undefined);
	if (governanceOpen && gauge.data?.isActive) {
		return <Text size="xs" c="gray">{gauge.data.status === 3 ? "Gauge removal pending" : "Active gauge"} · fees to voters · <Link href="/arena">Vote for pools</Link></Text>;
	}
	if (governanceOpen && !gauge.data) {
		return <Text size="xs" c="gray">{gauge.isError ? "Gauge status unavailable" : "Checking gauge status…"}</Text>;
	}
	const protocolBps = pool.getData().protocolFeeRate;
	const pending = governanceOpen && gauge.data?.status === 1;
	const lpPct = (10_000 - protocolBps) / 100;
	const protocolPct = protocolBps / 100;
	const incentivized = pools.has(pool.getAddress().toString());
	const label = incentivized
		? i18n._(
				"{protocol}% of swap fees fund the veSOLV3 bonus for this pool's LPs; {lp}% is paid to LPs directly.",
				{ protocol: protocolPct, lp: lpPct },
			)
		: i18n._("{protocol}% of swap fees go to the protocol; {lp}% to LPs.", {
				protocol: protocolPct,
				lp: lpPct,
			});
	return (
		<Tooltip multiline w={240} withArrow label={label}>
			<Text size="xs" c="gray">
				{pending && "Gauge activation pending · "}{i18n._("LP fee share {lp}%", { lp: lpPct })}
				{incentivized ? ` · ${i18n._("{protocol}% → veSOLV3 bonus", { protocol: protocolPct })}` : ""}
			</Text>
		</Tooltip>
	);
};
