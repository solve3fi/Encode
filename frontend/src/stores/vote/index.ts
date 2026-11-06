import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import type { VoteInfo } from "./hooks/useVotes";

export enum VoteMethods {
	ALL = "all",
}

// A pool the user has staged a vote for, with the percent of their voting
// power they've assigned to it. Extends the same VoteInfo record VoteLists
// constructs, so getAddress()/getData()/tokenAInfo/etc. keep working.
export type VoteState = VoteInfo & { votePercent: number };

export interface IVote {
	readonly method: VoteMethods;
	readonly lockId: number;
	readonly voteState: VoteState[];
	readonly searchQuery: string;
}

export interface IVoteActions {
	actions: {
		setMethod: (method: VoteMethods) => void;
		setLockId: (lockId: number) => void;
		setVoteState: (item: VoteState) => void;
		removeVoteState: (address: string) => void;
		resetVoteState: () => void;
		setSearchQuery: (searchQuery: string) => void;
	};
}

export interface IVoteStore extends IVote, IVoteActions {}

export const initVoteState: IVote = {
	method: VoteMethods.ALL,
	lockId: 0,
	voteState: [],
	searchQuery: "",
};

export type VoteStore = ReturnType<typeof createVoteStore>;

export const createVoteStore = (initState: IVote = initVoteState) => {
	return createStore<IVoteStore>()(
		immer((set) => ({
			...initState,
			actions: {
				setMethod: (method: VoteMethods) => set({ method }),
				setLockId: (lockId: number) => set({ lockId }),
				setVoteState: (item: VoteState) =>
					set((state) => {
						const address = item.getAddress().toString();
						const usedElsewhere = state.voteState.reduce((sum, existing) => sum + (existing.getAddress().toString() === address ? 0 : existing.votePercent), 0);
						const percent = Number.isFinite(item.votePercent) ? Math.min(Math.max(0, Math.round(item.votePercent)), Math.max(0, 100 - usedElsewhere)) : 0;
						if (percent === 0) {
							state.voteState = state.voteState.filter((existing) => existing.getAddress().toString() !== address);
							return;
						}
						// Keep SDK methods without mutating the cached pool instance.
						const next = Object.assign(Object.create(Object.getPrototypeOf(item)), item, { votePercent: percent });
						const index = state.voteState.findIndex(
							(existing) => existing.getAddress().toString() === address,
						);
						if (index >= 0) {
							state.voteState[index] = next;
						} else {
							state.voteState.push(next);
						}
					}),
				removeVoteState: (address: string) =>
					set((state) => {
						state.voteState = state.voteState.filter(
							(item) => item.getAddress().toString() !== address,
						);
					}),
				resetVoteState: () => set({ voteState: [] }),
				setSearchQuery: (searchQuery: string) => set({ searchQuery }),
			},
		})),
	);
};
