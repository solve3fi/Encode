"use client";

import { useLingui } from "@lingui/react";
import { Group, Text, Tooltip } from "@mantine/core";
import type { Solve } from "@solve3fi/sdk";
import { IconInfoCircle } from "@tabler/icons-react";
import { useLpBonusApr } from "@/hooks/useLpBonusApr";
import { useLpIncentives } from "@/hooks/useLpIncentives";
import { formatApr, formatFiat } from "@/lib/format";

export type PoolBonusAprProps = {
	pool: Solve;
};

// Soft-launch LP incentive: veSOLV3 credit issued to a pool's LPs, shown as
// an APR the same way RewardEmissionApr shows gauge emissions.
export const PoolBonusApr: React.FC<PoolBonusAprProps> = ({ pool }) => {
	const { i18n } = useLingui();
	const { veSolv3Usd } = useLpIncentives();
	const { state, apr, incentive } = useLpBonusApr(pool);

	if (state === "none") {
		return (
			<Text fw="bold" c="gray" data-numeric="true">
				—
			</Text>
		);
	}

	const feeSharePct = incentive ? incentive.config.feeShareBps / 100 : 0;
	const label = i18n._(
		"veSOLV3 credit earned by this pool's LPs over the last 7 days, annualized against TVL. {feeShare}% of swap fees fund it at {multiplier}× and are credited at {price} per veSOLV3 — claimable as permanently locked veSOLV3 at the ve launch.",
		{
			feeShare: feeSharePct,
			multiplier: incentive?.config.multiplier ?? 0,
			price: formatFiat(veSolv3Usd),
		},
	);

	return (
		<Tooltip multiline w={260} withArrow transitionProps={{ duration: 200 }} label={label}>
			<Group gap={2} wrap="nowrap">
				<Text fw="bold" data-numeric="true">
					{state === "ready"
						? formatApr(apr.toNumber(), { ceiling: 10_000 })
						: state === "accruing"
							? i18n._("Accruing")
							: "—"}
				</Text>
				<IconInfoCircle size={16} fill="inherit" />
			</Group>
		</Tooltip>
	);
};
