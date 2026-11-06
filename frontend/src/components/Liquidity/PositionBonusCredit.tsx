"use client";

import { useLingui } from "@lingui/react";
import { Stack, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import Decimal from "decimal.js";
import { useLpIncentives } from "@/hooks/useLpIncentives";
import { formatFiat } from "@/lib/format";
import { TokenBalance } from "../Token/TokenBalance";

export type PositionBonusCreditProps = {
	poolAddress: string;
};

// The connected wallet's accrued veSOLV3 credit for one pool (all of its
// positions in that pool together — the keeper credits per wallet).
export const PositionBonusCredit: React.FC<PositionBonusCreditProps> = ({ poolAddress }) => {
	const { i18n } = useLingui();
	const { pools, wallet, veSolv3Usd, isLoading } = useLpIncentives();
	const incentive = pools.get(poolAddress);
	const credit = wallet?.byPool[poolAddress];

	if (!incentive && !credit) {
		return (
			<Text fw="bold" c="gray" data-numeric="true">
				—
			</Text>
		);
	}
	const amount = new Decimal(credit ?? 0);
	return (
		<Tooltip
			multiline
			w={250}
			withArrow
			label={i18n._(
				"veSOLV3 credited to your wallet for providing in-range liquidity here. Claimable as permanently locked veSOLV3 at the ve launch; shown at {price} per veSOLV3.",
				{ price: formatFiat(veSolv3Usd) },
			)}
		>
			<Stack gap={0} align="flex-start">
				<Text fw="bold" data-numeric="true">
					<TokenBalance value={isLoading ? undefined : amount.toNumber()} loading={isLoading} decimalScale={2} />
				</Text>
				<Text fz="xs" c="gray">
					veSOLV3 · {formatFiat(amount.mul(veSolv3Usd).toNumber())} <IconInfoCircle size={13} fill="inherit" />
				</Text>
			</Stack>
		</Tooltip>
	);
};
