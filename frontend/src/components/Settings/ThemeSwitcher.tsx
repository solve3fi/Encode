"use client";

import type { MantineSize } from "@mantine/core";
import { ActionIcon, Group, Image, useMantineColorScheme } from "@mantine/core";

export const ThemeSwitcher: React.FC<{
	size?: MantineSize | string;
}> = ({ size = "lg" }) => {
	const { setColorScheme } = useMantineColorScheme();

	return (
		<Group justify="center">
			<ActionIcon
				onClick={() => setColorScheme("light")}
				variant="light"
				aria-label="Toggle light scheme"
				lightHidden
				radius="xl"
				size={size}
			>
				<Image src="/assets/icons/star.svg" alt="Star" />
			</ActionIcon>
			<ActionIcon
				onClick={() => setColorScheme("dark")}
				variant="light"
				aria-label="Toggle dark scheme"
				darkHidden
				radius="xl"
				size={size}
			>
				<Image src="/assets/icons/star-purple.svg" alt="Star" />
			</ActionIcon>
		</Group>
	);
};
