import { useLingui } from "@lingui/react";
import { Paper, Stack, Text } from "@mantine/core";

export const PoolStatus: React.FC = () => {
	const { i18n } = useLingui();

	return (
		<Paper p="md" shadow="sm" bg="dark.10">
			<Stack gap={5}>
				<Text>{i18n._("Current pool stats")}</Text>
				<Text c="gray" fz="sm">{i18n._("Historical pool statistics are not indexed yet.")}</Text>
			</Stack>
		</Paper>
	);
};
