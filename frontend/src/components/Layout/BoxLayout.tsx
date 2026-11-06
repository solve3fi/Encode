import { Box } from "@mantine/core";
import type { PropsWithChildren } from "react";

export const BoxLayout: React.FC<PropsWithChildren> = ({ children }) => {
	return (
		<Box
			py={{
				base: 20,
				md: 80,
			}}
		>
			{children}
		</Box>
	);
};
