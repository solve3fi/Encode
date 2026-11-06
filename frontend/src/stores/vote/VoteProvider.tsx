"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import {
	createContext,
	type PropsWithChildren,
	useContext,
	useRef,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { StoreSubscribeApi } from "@/types";
import { useCluster } from "@/providers/ClusterProvider";
import { createVoteStore, type IVoteStore } from ".";
import { useVoteConfig } from "./hooks/useVoteConfig";

export const VoteStoreContext =
	createContext<StoreSubscribeApi<IVoteStore> | null>(null);

export const VoteProvider: React.FC<PropsWithChildren> = ({ children }) => {
	const { network } = useCluster();
	const { publicKey } = useWallet();
	const { data: voteConfig } = useVoteConfig(network);
	const scope = `${network}:${publicKey?.toBase58() ?? "disconnected"}:${voteConfig?.epoch.toString() ?? "loading"}`;

	// Remount the draft and transaction UI together. A previous wallet's or
	// epoch's allocation/success message must never become this week's vote.
	// Only the confirmed protocol epoch changes this key, not the local clock.
	return <ScopedVoteProvider key={scope}>{children}</ScopedVoteProvider>;
};

const ScopedVoteProvider: React.FC<PropsWithChildren> = ({ children }) => {
	const storeRef = useRef<StoreSubscribeApi<IVoteStore>>(null);

	if (!storeRef.current) {
		storeRef.current = createVoteStore();
	}

	return (
		<VoteStoreContext.Provider value={storeRef.current}>
			{children}
		</VoteStoreContext.Provider>
	);
};

export const useVoteStore = <T,>(selector: (store: IVoteStore) => T): T => {
	const store = useContext(VoteStoreContext);
	if (!store) {
		throw new Error("useVoteStore must be used within a VoteProvider");
	}
	return useStore(store, selector);
};

export const useVote = <T,>(selector: (store: IVoteStore) => T): T =>
	useVoteStore(useShallow(selector));

export const useVoteActions = () =>
	useVoteStore(useShallow((state) => state.actions));
