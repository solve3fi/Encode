import { Card, Image } from "@mantine/core";
import classes from "./Presale.module.css";

export const PreSaleLeft: React.FC = () => {
	return (
		<Card shadow="sm" p={10} radius="lg" className={classes.bgBlur}>
			<Image src="/assets/images/presales.png" alt="pre-sales" />
		</Card>
	);
};
