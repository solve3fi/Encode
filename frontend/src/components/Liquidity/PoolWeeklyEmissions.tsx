"use client";

import { useLingui } from "@lingui/react";
import { Stack, Text, Tooltip } from "@mantine/core";
import type { Solve } from "@solve3fi/sdk";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEmissionApr } from "@/hooks/useEmissionApr";
import { TokenBalance } from "../Token/TokenBalance";

export type PoolWeeklyEmissionsProps = {
	pool: Solve;
};

export const PoolWeeklyEmissions: React.FC<PoolWeeklyEmissionsProps> = ({
	pool,
}) => {
	const { i18n } = useLingui();
	const { emissionAmount, isLoading, dataUnavailable } = useEmissionApr(pool);

	return (
		<Tooltip
			multiline
			w={230}
			withArrow
			label={i18n._(
				"SOLV3 allocated to this pool's gauge for the current weekly epoch.",
			)}
		>
			<Stack gap={0} align="flex-end">
				<Text fw="bold" data-numeric="true">
					{dataUnavailable ? (
						"—"
					) : (
						<TokenBalance
							value={isLoading ? undefined : emissionAmount.toNumber()}
							loading={isLoading}
							decimalScale={2}
						/>
					)}
				</Text>
				<Text fz="xs" c="gray">
					SOLV3 <IconInfoCircle size={13} fill="inherit" />
				</Text>
			</Stack>
		</Tooltip>
	);
};
