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
import {
	createSwapRouterStore,
	type ISwapRouterStore,
	initSwapRouterState,
} from ".";

export const SwapRouterStoreContext =
	createContext<StoreSubscribeApi<ISwapRouterStore> | null>(null);

export const SwapRouterProvider: React.FC<PropsWithChildren> = ({
	children,
}) => {
	const storeRef = useRef<StoreSubscribeApi<ISwapRouterStore>>(null);

	if (!storeRef.current) {
		storeRef.current = createSwapRouterStore(initSwapRouterState);
	}

	return (
		<SwapRouterStoreContext.Provider value={storeRef.current}>
			{children}
		</SwapRouterStoreContext.Provider>
	);
};

export const useSwapRouterStore = <T,>(
	selector: (store: ISwapRouterStore) => T,
): T => {
	const store = useContext(SwapRouterStoreContext);
	if (!store) {
		throw new Error(
			"useSwapRouterStore must be used within a SwapRouterStoreProvider",
		);
	}
	return useStore(store, selector);
};

export const useSwapRouter = <T,>(
	selector: (store: ISwapRouterStore) => T,
): T => useSwapRouterStore(useShallow(selector));

export const useSwapRouterActions = () =>
	useSwapRouterStore(useShallow((state) => state.actions));
