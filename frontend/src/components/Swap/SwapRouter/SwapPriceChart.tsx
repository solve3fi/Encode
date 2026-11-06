import { AreaChart } from "@mantine/charts";
import "@mantine/charts/styles.css";
import dayjs from "dayjs";

const data = Array.from({ length: 10 }, (_, index: number) => ({
	date: dayjs().subtract(index, "day").format("HH:mm"),
	price: Math.floor(Math.random() * 50),
}));

export const SwapPriceChart: React.FC = () => {
	return (
		<AreaChart
			h={340}
			data={data}
			dataKey="date"
			series={[{ name: "price", color: "indigo.6" }]}
			curveType="natural"
			tickLine="none"
			gridAxis="none"
			withYAxis={false}
			withDots={false}
		/>
	);
};
