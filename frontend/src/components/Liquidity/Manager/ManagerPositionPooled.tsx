import { useLingui } from "@lingui/react";
import { Badge, Group, NumberFormatter, Text } from "@mantine/core";
import { TokenBalance } from "@/components/Token/TokenBalance";

type ManagerPositionPooledProps = {
	symbol?: string;
	amount?: number | string;
	percent?: number | string;
};

export const ManagerPositionPooled: React.FC<ManagerPositionPooledProps> = ({
	amount,
	percent,
	symbol,
}) => {
	const { i18n } = useLingui();
	return (
		<Group justify="space-between">
			<Text fz="sm" c="gray.4" fw={600}>
				{`${i18n._("Pooled")} ${symbol}:`}
			</Text>
			<Group gap={8}>
				<Text fz="md" fw={600}>
					<TokenBalance loading={false} value={amount} decimalScale={9} />
				</Text>
				<Badge color="gray.17" variant="filled" radius="xs" size="lg" miw={80}>
					<Text fz="sm" fw={600}>
						<NumberFormatter value={percent} suffix="%" decimalScale={2} />
					</Text>
				</Badge>
			</Group>
		</Group>
	);
};
