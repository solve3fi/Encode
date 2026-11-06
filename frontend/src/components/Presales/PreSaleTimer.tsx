import { useLingui } from "@lingui/react";
import { Paper, rem, SimpleGrid, Stack, Text } from "@mantine/core";
import classes from "./PreSaleTimer.module.css";

type PreSaleTime = {
	days: string | number;
	hours: string | number;
	minutes: string | number;
	seconds: string | number;
};

export const PreSaleTimer: React.FC<PreSaleTime> = ({
	days,
	hours,
	minutes,
	seconds,
}) => {
	const { i18n } = useLingui();
	return (
		<SimpleGrid cols={4}>
			<Stack gap={0}>
				<Paper p={16} classNames={classes}>
					<Text size={rem(24)} fw={600} ta="center">
						{days}
					</Text>
				</Paper>
				<Text ta="center" fz="sm" fw={600}>
					{i18n._("Days")}
				</Text>
			</Stack>
			<Stack gap={0}>
				<Paper p={16} classNames={classes}>
					<Text size={rem(24)} fw={600} ta="center">
						{hours}
					</Text>
				</Paper>
				<Text ta="center" fz="sm" fw={600}>
					{i18n._("Hours")}
				</Text>
			</Stack>
			<Stack gap={0}>
				<Paper p={16} classNames={classes}>
					<Text size={rem(24)} fw={600} ta="center">
						{minutes}
					</Text>
				</Paper>
				<Text ta="center" fz="sm" fw={600}>
					{i18n._("Minutes")}
				</Text>
			</Stack>
			<Stack gap={0}>
				<Paper p={16} classNames={classes}>
					<Text size={rem(24)} fw={600} ta="center">
						{seconds}
					</Text>
				</Paper>
				<Text ta="center" fz="sm" fw={600}>
					{i18n._("Secs")}
				</Text>
			</Stack>
		</SimpleGrid>
	);
};
