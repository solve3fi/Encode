"use client";

import type { MantineSize } from "@mantine/core";
import { ActionIcon, Avatar, Image, Menu } from "@mantine/core";
import NextImage from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentLocale } from "next-i18n-router/client";
import { useCallback, useMemo, useState } from "react";

import type { SupportedLocale } from "@/i18n/i18n-config";
import { i18n, languages } from "@/i18n/i18n-config";

export const LocaleSwitcher: React.FC<{
	size?: MantineSize;
}> = ({ size = "lg" }) => {
	const [opened, setOpened] = useState(false);
	const lang = useCurrentLocale(i18n);
	const selected = useMemo(
		() => languages.find((item) => item.code === lang) || languages[0],
		[lang],
	);

	const pathName = usePathname();
	const redirectedPathName = useCallback(
		(locale: SupportedLocale) => {
			if (!pathName) return "/";
			const segments = pathName.split("/");
			segments[1] = locale;
			return segments.join("/");
		},
		[pathName],
	);

	const items = languages.map((item) => (
		<Menu.Item
			leftSection={<Avatar src={item.icon} size="sm" alt={item.name} />}
			component={Link}
			href={redirectedPathName(item.code)}
			key={item.name}
		>
			{item.name}
		</Menu.Item>
	));

	return (
		<Menu
			onOpen={() => setOpened(true)}
			onClose={() => setOpened(false)}
			radius="md"
			width={150}
			withinPortal
			transitionProps={{
				duration: 250,
				transition: "pop-bottom-right",
			}}
		>
			<Menu.Target>
				<ActionIcon
					variant="transparent"
					data-expanded={opened || undefined}
					size={size}
				>
					<Image
						component={NextImage}
						src={`${selected?.icon}`}
						fill
						alt={`${selected?.name}`}
						radius="xl"
					/>
				</ActionIcon>
			</Menu.Target>
			<Menu.Dropdown>{items}</Menu.Dropdown>
		</Menu>
	);
};
