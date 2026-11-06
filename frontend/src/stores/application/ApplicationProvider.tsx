"use client";

import {
	createContext,
	type PropsWithChildren,
	useContext,
	useRef,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { StoreApi } from "zustand/vanilla";
import { createApplicationStore, type IApplicationStore } from ".";

export const ApplicationStoreContext =
	createContext<StoreApi<IApplicationStore> | null>(null);

export const ApplicationProvider: React.FC<PropsWithChildren> = ({
	children,
}) => {
	const storeRef = useRef<StoreApi<IApplicationStore>>(null);

	if (!storeRef.current) {
		storeRef.current = createApplicationStore();
	}

	return (
		<ApplicationStoreContext.Provider value={storeRef.current}>
			{children}
		</ApplicationStoreContext.Provider>
	);
};

export const useApplicationStore = <T,>(
	selector: (store: IApplicationStore) => T,
): T => {
	const store = useContext(ApplicationStoreContext);
	if (!store) {
		throw new Error(
			"useApplicationStore must be used within a ApplicationStoreProvider",
		);
	}
	return useStore(store, selector);
};

export const useApplication = <T,>(
	selector: (store: IApplicationStore) => T,
): T => useApplicationStore(useShallow(selector));

export const useApplicationActions = () =>
	useApplicationStore(useShallow((state) => state.actions));
