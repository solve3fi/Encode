import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

export enum LiquidityMethods {
	ALL = "all",
	STOCKS = "stocks",
	MY_POOLS = "my-pools",
}

export enum LiquidityTypes {
	ALL = "all",
	STABLE = "stable",
	FLEXIBLE = "flexible",
}

export interface ILiquidity {
	readonly method: LiquidityMethods;
	readonly type: string;
	readonly filter: string;
}

export interface ILiquidityActions {
	actions: {
		setMethod: (method: LiquidityMethods) => void;
		setType: (type: string) => void;
		setFilter: (filter: string) => void;
	};
}

export interface ILiquidityStore extends ILiquidity, ILiquidityActions {}

export const initLiquidityState: ILiquidity = {
	method: LiquidityMethods.ALL,
	type: LiquidityTypes.ALL,
	filter: "",
};

export type LiquidityStore = ReturnType<typeof createLiquidityStore>;

export const createLiquidityStore = (
	initState: ILiquidity = initLiquidityState,
) => {
	return createStore<ILiquidityStore>()(
		immer(
			subscribeWithSelector((set) => ({
				...initState,
				actions: {
					setMethod: (method: LiquidityMethods) => set({ method }),
					setType: (type: string) => set({ type }),
					setFilter: (filter: string) => set({ filter }),
				},
			})),
		),
	);
};
