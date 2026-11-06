import { Button, Group } from "@mantine/core";
import { CHART_VIEWS } from "@/stores/swap-router";
import {
	useSwapRouter,
	useSwapRouterActions,
} from "@/stores/swap-router/SwapRouterProvider";

export const SwapChartView: React.FC = () => {
	const chartView = useSwapRouter((state) => state.chartView);
	const { setChartView } = useSwapRouterActions();
	return (
		<Group gap={10}>
			{CHART_VIEWS.map((view) => (
				<Button
					key={view}
					size="sm"
					variant={chartView === view ? "filled" : "light"}
					color={chartView === view ? "purple.8" : "gray.13"}
					radius="sm"
					onClick={() => setChartView(view)}
				>
					{view}
				</Button>
			))}
		</Group>
	);
};
