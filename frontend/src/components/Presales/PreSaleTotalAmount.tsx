import { useLingui } from "@lingui/react";
import { NumberFormatter, Paper, Stack, Text } from "@mantine/core";

export const PreSaleTotalAmount: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Stack gap={4}>
			<Text fw={600} ta="center">
				{i18n._("Total Amount")}
			</Text>
			<Paper p={4} bg="dark.10">
				<Text fz="xl" fw={600} c="var(--color-bf8440)" ta="center" lh="lg">
					<NumberFormatter
						thousandSeparator=","
						decimalSeparator="."
						value={444308.81}
					/>
				</Text>
			</Paper>
		</Stack>
	);
};
