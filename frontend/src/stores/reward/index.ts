import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";

export enum RewardMethods {
	LIQUIDITY = "liquidity",
	VOTE = "vote",
}

export interface IReward {
	readonly method: RewardMethods;
	readonly filter: string;
	readonly lockId: number;
	readonly epoch: number;
}

export interface IRewardActions {
	actions: {
		setMethod: (method: RewardMethods) => void;
		setFilter: (filter: string) => void;
		setLockId: (lockId: number) => void;
		setEpoch: (epoch: number) => void;
	};
}

export interface IRewardStore extends IReward, IRewardActions {}

export const initRewardState: IReward = {
	method: RewardMethods.LIQUIDITY,
	filter: "",
	lockId: 0,
	epoch: 0,
};

export type RewardStore = ReturnType<typeof createRewardStore>;

export const createRewardStore = (initState: IReward = initRewardState) => {
	return createStore<IRewardStore>()(
		immer(
			subscribeWithSelector((set) => ({
				...initState,
				actions: {
					setMethod: (method: RewardMethods) => set({ method }),
					setFilter: (filter: string) => set({ filter }),
					setLockId: (lockId: number) => set({ lockId }),
					setEpoch: (epoch: number) => set({ epoch }),
				},
			})),
		),
	);
};
