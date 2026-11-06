import { useLingui } from "@lingui/react";
import { ActionIcon, Group, Paper, Stack, Text } from "@mantine/core";
import { IconMinus, IconPlus } from "@tabler/icons-react";

export type PoolPriceCustomProps = {
	label: string;
	value?: number | string;
	tokenA?: string;
	tokenB?: string;
	setDecrement: () => void;
	setIncrement: () => void;
};

export const PoolPriceCustom: React.FC<PoolPriceCustomProps> = ({
	label,
	value,
	tokenA,
	tokenB,
	setDecrement,
	setIncrement,
}) => {
	const { i18n } = useLingui();

	return (
		<Paper p={20} flex={1} bg="dark.10">
			<Group align="center" justify="space-between">
				<ActionIcon
					variant="filled"
					size="xl"
					radius="xl"
					color="gray"
					bg="var(--mantine-color-dark-10)"
					onClick={setDecrement}
				>
					<IconMinus color="var(--mantine-color-gray-14)" />
				</ActionIcon>
				<Stack gap={0} ta="center">
					<Text fz="xs" fw="bold" c="gray">
						{label}
					</Text>
					<Text fz="lg" fw="bold">
						{value}
					</Text>
					<Text fz="xs" fw="bold" c="gray">
						{tokenB}{" "}
						<Text span inherit>
							{i18n._("per")}{" "}
						</Text>
						<Text span inherit>
							{tokenA}
						</Text>
					</Text>
				</Stack>
				<ActionIcon
					variant="filled"
					size="xl"
					radius="xl"
					color="gray"
					bg="var(--mantine-color-dark-10)"
					onClick={setIncrement}
				>
					<IconPlus color="var(--mantine-color-gray-14)" />
				</ActionIcon>
			</Group>
		</Paper>
	);
};
