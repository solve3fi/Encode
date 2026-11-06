import { useLingui } from "@lingui/react";
import { Group, Paper, Stack, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type Decimal from "decimal.js";
import { TokenBalance } from "@/components/Token/TokenBalance";

export type ManagerRemoveReceiveProps = {
	liquidityValue0?: Decimal;
	liquidityValue1?: Decimal;
	token0?: TokenInfo | null;
	token1?: TokenInfo | null;
};

export const ManagerRemoveReceive: React.FC<ManagerRemoveReceiveProps> = ({
	liquidityValue0,
	liquidityValue1,
	token0,
	token1,
}) => {
	const { i18n } = useLingui();
	return (
		<Paper p="md" shadow="sm">
			<Stack>
				<Group justify="space-between">
					<Text fz="md" c="gray.4" fw={600}>
						{`${token0?.symbol} ${i18n._("Receive:")}`}
					</Text>
					<Text fz="md" fw={600}>
						<TokenBalance value={liquidityValue0?.toString()} loading={false} decimalScale={4} />
					</Text>
				</Group>
				<Group justify="space-between">
					<Text fz="md" c="gray.4" fw={600}>
						{`${token1?.symbol} ${i18n._("Receive:")}`}
					</Text>
					<Text fz="md" fw={600}>
						<TokenBalance value={liquidityValue1?.toString()} loading={false} decimalScale={4} />
					</Text>
				</Group>
			</Stack>
		</Paper>
	);
};
