import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

export interface IPoolManager {
	readonly removePercent: number;
	readonly sorted: boolean;
}

export interface IPoolManagerActions {
	actions: {
		setRemovePercent: (removePercent: number) => void;
		setSorted: (sorted: boolean) => void;
	};
}

export interface IPoolManagerStore extends IPoolManager, IPoolManagerActions {}

export const initPoolState: IPoolManager = {
	removePercent: 25,
	sorted: false,
};

export type PoolManagerStore = ReturnType<typeof createPoolManagerStore>;

export const createPoolManagerStore = (
	initState: IPoolManager = initPoolState,
) => {
	return createStore<IPoolManagerStore>()(
		immer(
			subscribeWithSelector((set) => ({
				...initState,
				actions: {
					setRemovePercent: (removePercent: number) => set({ removePercent }),
					setSorted: (sorted: boolean) => set({ sorted }),
				},
			})),
		),
	);
};
