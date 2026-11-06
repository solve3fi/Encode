import { useLingui } from "@lingui/react";
import { Avatar, Group, Text } from "@mantine/core";

export const SwapBrandDescription: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Group gap={4} justify="center" c="gray">
			<Text fz="sm">{i18n._("Powerd by")}</Text>
			<Avatar src="/assets/icons/jupiter-logo.svg" alt="jupiter" size={24} />
			<Text fz="sm">{i18n._("Jupiter")}</Text>
		</Group>
	);
};
