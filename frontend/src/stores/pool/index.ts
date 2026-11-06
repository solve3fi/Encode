import type { Address, Percentage } from "@solve3fi/common";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import type { ALMInfo } from "@/configs/alms";

export enum FeeAmount {
	LOWEST = 100,
	LOW_200 = 200,
	LOW_300 = 300,
	LOW_400 = 400,
	LOW = 500,
	HIGH_160 = 1600,
	HIGH_650 = 6500,
	MEDIUM = 3000,
	HIGH = 10000,
	HIGH_2000 = 20000,
	HIGH_3000 = 30000,
	HIGH_4000 = 40000,
	HIGH_5000 = 50000,
}

export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
	[FeeAmount.LOWEST]: 1,
	[FeeAmount.LOW_200]: 2,
	[FeeAmount.LOW_300]: 3,
	[FeeAmount.LOW_400]: 4,
	[FeeAmount.LOW]: 8,
	[FeeAmount.MEDIUM]: 64,
	[FeeAmount.HIGH]: 128,
	[FeeAmount.HIGH_160]: 16,
	[FeeAmount.HIGH_650]: 96,
	[FeeAmount.HIGH_2000]: 256,
	// Tick spacing scales with the fee (~128 per 1%). The program allows rates up to 6.00%.
	[FeeAmount.HIGH_3000]: 384,
	[FeeAmount.HIGH_4000]: 512,
	[FeeAmount.HIGH_5000]: 640,
};

export enum Field {
	CURRENCY_A = "currencyA",
	CURRENCY_B = "currencyB",
}

export enum PriceInputs {
	LOWER = "LOWER",
	UPPER = "UPPER",
}

export enum PoolTypes {
	AUTOMATIC = "AUTOMATIC",
	MANUAL = "MANUAL",
}

export enum PriceRange {
	FULL_RANGE = "FULL_RANGE",
	BPS_20000 = "BPS_20000",
	BPS_12000 = "BPS_12000",
	BPS_10100 = "BPS_10100",
	LEFT_SIDE = "LEFT_SIDE",
	RIGHT_SIDE = "RIGHT_SIDE",
}

export type PoolRangeTypes = {
	active: number;
	label: string;
	type: PriceRange;
	demission: Percentage | null;
};

export type FeeTierTypes = {
	fee: number;
	label: string;
	description: string;
	select: number;
	tickSpacing: number;
	featured?: boolean;
};

export interface IPool {
	readonly currencyA: Address;
	readonly currencyB: Address;
	readonly poolType: PoolTypes;
	readonly range: PoolRangeTypes;
	readonly typedValue: number;
	readonly independentField: Field;
	readonly alm: ALMInfo;
	readonly feeTier: FeeAmount;
	readonly desiredAmount: number;
	readonly lowerPrice: number | boolean;
	readonly upperPrice: number | boolean;
}

export interface IPoolActions {
	actions: {
		setCurrencyA: (currencyA: Address) => void;
		setCurrencyB: (currencyB: Address) => void;
		setIndependentField: (independentField: Field) => void;
		setPoolType: (poolType: PoolTypes) => void;
		setRange: (range: PoolRangeTypes) => void;
		setTypedValue: (typedValue: number) => void;
		setAlm: (alm: ALMInfo) => void;
		setFeeTier: (feeTier: FeeAmount) => void;
		setDesiredAmount: (desiredAmount: number) => void;
		setLowerPrice: (lowerPrice: number | boolean) => void;
		setUpperPrice: (upperPrice: number | boolean) => void;
		switchToken: () => void;
		reset: () => void;
	};
}

export interface IPoolStore extends IPool, IPoolActions {}

export const initPoolState: IPool = {
	currencyA: "",
	currencyB: "",
	poolType: PoolTypes.MANUAL,
	range: {} as PoolRangeTypes,
	typedValue: 0,
	independentField: Field.CURRENCY_A,
	alm: {} as ALMInfo,
	feeTier: FeeAmount.HIGH,
	desiredAmount: 0,
	lowerPrice: true,
	upperPrice: true,
};

export type PoolStore = ReturnType<typeof createPoolStore>;

export const createPoolStore = (initState: IPool = initPoolState) => {
	return createStore<IPoolStore>()(
		immer(
			subscribeWithSelector((set, get) => ({
				...initState,
				actions: {
					setCurrencyA: (currencyA: Address) => {
						if (currencyA.toString() === get().currencyA.toString()) return;
						if (currencyA.toString() === get().currencyB.toString()) {
							set({ currencyA: get().currencyB, currencyB: get().currencyA });
						} else {
							set({ currencyA });
						}
					},
					setCurrencyB: (currencyB: Address) => {
						if (currencyB.toString() === get().currencyB.toString()) return;
						if (currencyB.toString() === get().currencyA.toString()) {
							set({ currencyB: get().currencyA, currencyA: get().currencyB });
						} else {
							set({ currencyB });
						}
					},
					setIndependentField: (independentField: Field) =>
						set({ independentField }),
					setPoolType: (poolType: PoolTypes) => set({ poolType }),
					setRange: (range: PoolRangeTypes) => set({ range }),
					setTypedValue: (typedValue: number) => set({ typedValue }),
					setAlm: (alm: ALMInfo) => set({ alm }),
					setFeeTier: (feeTier: FeeAmount) => set({ feeTier }),
					setDesiredAmount: (desiredAmount: number) =>
						set({ desiredAmount, lowerPrice: true, upperPrice: true }),
					setLowerPrice: (lowerPrice: number | boolean) => set({ lowerPrice }),
					setUpperPrice: (upperPrice: number | boolean) => set({ upperPrice }),
					switchToken: () => {
						set((state) => ({
							currencyA: state.currencyB,
							currencyB: state.currencyA,
							independentField:
								state.independentField === Field.CURRENCY_A
									? Field.CURRENCY_B
									: Field.CURRENCY_A,
						}));
					},
					reset: () =>
						set({
							lowerPrice: true,
							upperPrice: true,
							range: {} as PoolRangeTypes,
						}),
				},
			})),
		),
	);
};
