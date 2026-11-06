import { useLingui } from "@lingui/react";
import {
	Avatar,
	Group,
	NumberFormatter,
	Paper,
	rem,
	Stack,
	Text,
} from "@mantine/core";

export const PreSaleAmount: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Stack gap={4}>
			<Text fw={600}>{i18n._("Deposit Amount")}</Text>
			<Paper p={8} bg="dark.10">
				<Group justify="space-between">
					<Group gap={4} align="center">
						<Avatar size={rem(24)} src="/assets/tokens/sol.png" />
						<Text fz={rem(14)} fw={600}>
							SOL
						</Text>
					</Group>
					<NumberFormatter value={0.0} />
				</Group>
			</Paper>
		</Stack>
	);
};
