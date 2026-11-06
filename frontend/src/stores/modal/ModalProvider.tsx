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
import { createModalStore, type IModalStore } from ".";

export const ModalStoreContext = createContext<StoreApi<IModalStore> | null>(
	null,
);

export const ModalProvider: React.FC<PropsWithChildren> = ({ children }) => {
	const storeRef = useRef<StoreApi<IModalStore>>(null);

	if (!storeRef.current) {
		storeRef.current = createModalStore();
	}

	return (
		<ModalStoreContext.Provider value={storeRef.current}>
			{children}
		</ModalStoreContext.Provider>
	);
};

export const useModalStore = <T,>(selector: (store: IModalStore) => T): T => {
	const store = useContext(ModalStoreContext);
	if (!store) {
		throw new Error("useModalStore must be used within a ModalStoreProvider");
	}
	return useStore(store, selector);
};

export const useModal = <T,>(selector: (store: IModalStore) => T): T =>
	useModalStore(useShallow(selector));

export const useModalActions = () =>
	useModalStore(useShallow((state) => state.actions));
