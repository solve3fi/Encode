import { useLingui } from "@lingui/react";
import { Stack, Title } from "@mantine/core";

export const PreSaleRightTitle: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Stack align="center">
			<Title fz="xl" fw={600}>
				{i18n._("On Sale veSOLV3")}
			</Title>
			<Title fz="xl" fw={600} c="var(--color-bf8440)">
				{i18n._("500,000,000.00 veSOLV3")}
			</Title>
		</Stack>
	);
};
