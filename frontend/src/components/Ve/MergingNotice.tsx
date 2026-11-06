"use client";

import { useLingui } from "@lingui/react";
import { Box, Flex, Text } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";

export const MergingNotice: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Flex align="top" gap={5}>
			<Box flex={1} mt={2}>
				<IconHelpCircle />
			</Box>
			<Text>
				{i18n._(
					"Merging will reset any rewards and rebases! Before continuing, please make sure you have reviewed and claimed all available rewards.",
				)}
			</Text>
		</Flex>
	);
};
