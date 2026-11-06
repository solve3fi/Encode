import { ActionIcon, Group, NumberFormatter, Text } from "@mantine/core";
import { IconArrowsSort, IconRefresh } from "@tabler/icons-react";
import classes from "./BridgeSwapAmount.module.css";

export const BridgeSwapAmount: React.FC = () => {
	return (
		<Group justify="space-between">
			<ActionIcon h={40} w={40} classNames={classes}>
				<IconArrowsSort size={24} />
			</ActionIcon>

			<Group gap={4}>
				<Text fw="bold" c="gray">
					Price{" "}
					<Text span inherit c="success.8">
						<NumberFormatter
							value={1}
							thousandSeparator=","
							decimalSeparator="."
							decimalScale={4}
							suffix=" SOLV3"
						/>
						{" = "}
						<NumberFormatter
							value={24.233}
							thousandSeparator=","
							decimalSeparator="."
							decimalScale={4}
							suffix=" USDT"
						/>
					</Text>
				</Text>
				<ActionIcon variant="transparent">
					<IconRefresh
						size={16}
						color="var(--mantine-color-purple-9)"
						stroke={3}
					/>
				</ActionIcon>
			</Group>
		</Group>
	);
};
