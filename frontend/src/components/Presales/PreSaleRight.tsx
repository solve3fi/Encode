import { Card, Stack } from "@mantine/core";
import dynamic from "next/dynamic";
import { PreSaleAmount } from "./PreSaleAmount";
import { PreSaleRightDetail } from "./PreSaleRightDetail";
import { PreSaleRightTitle } from "./PreSaleRightTitle";
import { PreSaleTotalAmount } from "./PreSaleTotalAmount";
import classes from "./Presale.module.css";

const ClientCountdown = dynamic(() =>
	import("./PreSaleCountdown").then((mod) => mod.PreSaleCountdown),
);

export const PreSaleRight: React.FC = () => {
	return (
		<Card className={classes.bgBlack} h="100%" radius="md">
			<Stack>
				<PreSaleRightTitle />
				<ClientCountdown />
				<PreSaleAmount />
				<PreSaleTotalAmount />
				<PreSaleRightDetail />
			</Stack>
		</Card>
	);
};
