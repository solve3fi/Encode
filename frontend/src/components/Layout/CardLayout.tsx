import { Card, type CardProps } from "@mantine/core";
import type { PropsWithChildren } from "react";

export const CardLayout: React.FC<PropsWithChildren<CardProps>> = ({
	children,
	...props
}) => {
	return (
		<Card
			withBorder
			padding="lg"
			bg="var(--surface-genesis)"
			style={{
				borderWidth: 1,
				borderColor: "var(--border-genesis)",
				borderRadius: 18,
				boxShadow: "none",
			}}
			{...props}
		>
			{children}
		</Card>
	);
};
