import { useLingui } from "@lingui/react";
import { Avatar, Group, Paper, Text } from "@mantine/core";

export const BridgeBadge = () => {
	const { i18n } = useLingui();
	return (
		<Paper px={12} py={8} radius="sm" bg="dark.10">
			<Group gap={4}>
				<Avatar src="/assets/tokens/yeve_2.png" alt="oyeve" size={20} />
				<Text fw="bold" fz="sm" c="gray">
					{i18n._("USDC")}
				</Text>
			</Group>
		</Paper>
	);
};
