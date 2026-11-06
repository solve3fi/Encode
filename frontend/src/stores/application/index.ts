import { persist } from "zustand/middleware";
import { createStore } from "zustand/vanilla";

export const DEFAULT_SLIPPAGE: number = 0.5;
export const DEFAULT_DEADLINE: number = 20;
export const SLIPPAGES: number[] = [0.1, 0.5, 1.0];

export enum SwapType {
	SWAP = "swap",
	ORDER = "order",
}

export interface IApplication {
	readonly slippage: number | "auto";
	readonly swapType: SwapType;
	readonly deadline: number;
}

export interface IApplicationActions {
	readonly actions: {
		setSlippage: (slippage: number | "auto") => void;
		setSwapType: (swapType: SwapType) => void;
		setDeadline: (deadline: number) => void;
		reset: () => void;
	};
}

export interface IApplicationStore extends IApplication, IApplicationActions {}

export const initApplicationState: IApplication = {
	slippage: DEFAULT_SLIPPAGE,
	swapType: SwapType.SWAP,
	deadline: DEFAULT_DEADLINE,
};

export type ApplicationStore = ReturnType<typeof createApplicationStore>;

export const createApplicationStore = (
	initState: IApplication = initApplicationState,
) => {
	return createStore<IApplicationStore>()(
		persist(
			(set) => ({
				...initState,
				actions: {
					setSlippage: (slippage: number | "auto") => set({ slippage }),
					setSwapType: (swapType: SwapType) => set({ swapType }),
					setDeadline: (deadline: number) => set({ deadline }),
					reset: () => set(initState),
				},
			}),
			{
				name: "application",
				partialize: (state) => ({
					slippage: state.slippage,
					swapType: state.swapType,
					deadline: state.deadline,
				}),
			},
		),
	);
};
