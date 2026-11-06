"use client";
import { Grid } from "@mantine/core";
import { PreSaleLeft } from "./PreSaleLeft";
import { PreSaleRight } from "./PreSaleRight";

export const PreSales: React.FC = () => {
	return (
		<Grid
			gutter={{ base: 5, xs: "md", md: "xl", xl: 32 }}
			py={{
				base: 20,
				md: 80,
			}}
		>
			<Grid.Col
				span={{
					base: 12,
					lg: 7,
				}}
			>
				<PreSaleLeft />
			</Grid.Col>

			<Grid.Col
				span={{
					base: 12,
					lg: 5,
				}}
			>
				<PreSaleRight />
			</Grid.Col>
		</Grid>
	);
};
