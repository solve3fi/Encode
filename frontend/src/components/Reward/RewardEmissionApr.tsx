import { Group, Text, Tooltip } from "@mantine/core";
import type { Address } from "@solve3fi/common";
import { IconInfoCircle } from "@tabler/icons-react";
import { useLingui } from "@lingui/react";
import { useEmissionApr } from "@/hooks/useEmissionApr";
import { usePoolInfo } from "@/hooks/usePoolInfo";
import { formatApr } from "@/lib/format";

export type RewardEmissionAprProps = {
	poolAddress: Address;
};

export const RewardEmissionApr: React.FC<RewardEmissionAprProps> = ({
	poolAddress,
}) => {
	const { i18n } = useLingui();
	const { data: pool } = usePoolInfo(poolAddress);
	const { apr, isLoading, pricingComplete } = useEmissionApr(pool);
	const value = apr.toNumber();
	const display = formatApr(value, { ceiling: 10_000 });

	return (
		<Tooltip
			multiline
			w={220}
			withArrow
			transitionProps={{ duration: 200 }}
			label={i18n._("Annualized SOLV3 gauge emissions relative to current TVL, using the current epoch rate. Trading fees and voting incentives are excluded. Very high values on thin liquidity are not meaningful.")}
		>
			<Group gap={2}>
				<Text fw="bold" data-numeric="true">{isLoading || pricingComplete === false ? "—" : display}</Text>
				<IconInfoCircle size={16} fill="inherit" />
			</Group>
		</Tooltip>
	);
};
