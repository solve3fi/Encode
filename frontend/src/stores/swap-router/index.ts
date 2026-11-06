import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

export enum ChartType {
	BASIC = "basic",
	PRO = "pro",
}

export const CHART_VIEWS: string[] = ["1H", "4H", "1D", "1W", "1M", "6M"];

export interface ISwapRouter {
	readonly chartType: ChartType;
	readonly chartView: string;
}

export interface ISwapRouterActions {
	actions: {
		setChartType: (chartType: ChartType) => void;
		setChartView: (chartView: string) => void;
	};
}

export interface ISwapRouterStore extends ISwapRouter, ISwapRouterActions {}

export const initSwapRouterState: ISwapRouter = {
	chartType: ChartType.BASIC,
	chartView: "1D",
};

export type SwapRouterStore = ReturnType<typeof createSwapRouterStore>;

export const createSwapRouterStore = (
	initState: ISwapRouter = initSwapRouterState,
) => {
	return createStore<ISwapRouterStore>()(
		immer(
			subscribeWithSelector((set) => ({
				...initState,
				actions: {
					setChartType: (chartType: ChartType) => set({ chartType }),
					setChartView: (chartView: string) => set({ chartView }),
				},
			})),
		),
	);
};
