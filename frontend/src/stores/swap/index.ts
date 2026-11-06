import type { Address } from "@solve3fi/common";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

export enum Field {
	INPUT = "INPUT",
	OUTPUT = "OUTPUT",
}

export enum TradeState {
	LOADING = "LOADING",
	INVALID = "INVALID",
	NO_ROUTE_FOUND = "NO_ROUTE_FOUND",
	VALID = "VALID",
	SYNCING = "SYNCING",
}

export interface ISwap {
	readonly from: Address;
	readonly to: Address;
	readonly typedValue: number;
	readonly recipient?: Address;
	readonly independentField: Field;
}

export interface ISwapActions {
	actions: {
		switchToken: () => void;
		setTo: (to: Address | string) => void;
		setFrom: (from: Address | string) => void;
		setTypedValue: (typedValue: number) => void;
		setRecipient: (recipient: Address) => void;
		setIndependentField: (independentField: Field) => void;
	};
}

export interface ISwapStore extends ISwap, ISwapActions {}

export const initSwapState: ISwap = {
	from: "",
	to: "",
	typedValue: 0,
	recipient: undefined,
	independentField: Field.INPUT,
};

export type SwapStore = ReturnType<typeof createSwapStore>;

export const createSwapStore = (initState: ISwap = initSwapState) => {
	return createStore<ISwapStore>()(
		immer(
			subscribeWithSelector((set, get) => ({
				...initState,
				actions: {
					switchToken: () =>
						set((state) => ({
							from: state.to,
							to: state.from,
							independentField:
								state.independentField === Field.INPUT
									? Field.OUTPUT
									: Field.INPUT,
						})),
					setTo: (to: Address | string) => {
						if (to.toString() === get().to.toString()) return;
						if (to.toString() === get().from.toString()) {
							set({ to: get().from, from: get().to });
						} else {
							set({ to });
						}
					},
					setFrom: (from: Address | string) => {
						if (from.toString() === get().from.toString()) return;
						if (from.toString() === get().to.toString()) {
							set({ from: get().to, to: get().from });
						} else {
							set({ from });
						}
					},
					setTypedValue: (typedValue: number) => set({ typedValue }),
					setRecipient: (recipient: Address) => set({ recipient }),
					setIndependentField: (independentField: Field) =>
						set({ independentField }),
				},
			})),
		),
	);
};
