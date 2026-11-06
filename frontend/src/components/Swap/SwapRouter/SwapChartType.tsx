import { useLingui } from "@lingui/react";
import { SegmentedControl, Text } from "@mantine/core";
import type { ChartType } from "@/stores/swap-router";
import {
	useSwapRouter,
	useSwapRouterActions,
} from "@/stores/swap-router/SwapRouterProvider";
import classes from "./SwapChartType.module.css";

export const SwapChartType: React.FC = () => {
	const chartType = useSwapRouter((state) => state.chartType);
	const { setChartType } = useSwapRouterActions();
	const { i18n } = useLingui();
	return (
		<SegmentedControl
			color="purple.10"
			classNames={classes}
			value={chartType}
			onChange={(value: string) => setChartType(value as ChartType)}
			size="lg"
			data={[
				{
					value: "basic",
					label: (
						<Text fw={600} px={5}>
							{i18n._("Basic")}
						</Text>
					),
				},
				{
					value: "pro",
					label: (
						<Text fw={600} px={5}>
							{i18n._("Pro")}
						</Text>
					),
					disabled: true,
				},
			]}
		/>
	);
};
