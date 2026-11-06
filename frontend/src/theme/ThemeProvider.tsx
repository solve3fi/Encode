"use client";

import { MantineProvider } from "@mantine/core";
import type React from "react";
import type { PropsWithChildren } from "react";

import Notifications from "@/components/Notifications";

import { theme } from "./theme";

export const ThemeProvider: React.FC<PropsWithChildren> = ({ children }) => {
	return (
		<MantineProvider
			theme={theme}
			classNamesPrefix="yeve"
			defaultColorScheme="dark"
			forceColorScheme="dark"
		>
			{children}
			<Notifications />
		</MantineProvider>
	);
};
