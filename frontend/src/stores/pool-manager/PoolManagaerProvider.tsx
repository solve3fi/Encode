"use client";

import {
	createContext,
	type PropsWithChildren,
	useContext,
	useRef,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { StoreSubscribeApi } from "@/types";
import { createPoolManagerStore, type IPoolManagerStore } from ".";

export const PoolManagerStoreContext =
	createContext<StoreSubscribeApi<IPoolManagerStore> | null>(null);

export const PoolManagerProvider: React.FC<PropsWithChildren> = ({
	children,
}) => {
	const storeRef = useRef<StoreSubscribeApi<IPoolManagerStore>>(null);

	if (!storeRef.current) {
		storeRef.current = createPoolManagerStore({
			removePercent: 25,
			sorted: false,
		});
	}

	return (
		<PoolManagerStoreContext.Provider value={storeRef.current}>
			{children}
		</PoolManagerStoreContext.Provider>
	);
};

export const usePoolManagerStore = <T,>(
	selector: (store: IPoolManagerStore) => T,
): T => {
	const store = useContext(PoolManagerStoreContext);
	if (!store) {
		throw new Error(
			"usePoolManagerStore must be used within a PoolManagerStoreProvider",
		);
	}
	return useStore(store, selector);
};

export const usePoolManager = <T,>(
	selector: (store: IPoolManagerStore) => T,
): T => usePoolManagerStore(useShallow(selector));

export const usePoolManagerActions = () =>
	usePoolManagerStore(useShallow((state) => state.actions));
