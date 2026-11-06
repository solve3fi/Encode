"use client";

import { shallowEqual } from "@mantine/hooks";
import { STOCKS_SECTION_ENABLED } from "@/configs/stockAssets";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useRef,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { StoreSubscribeApi } from "@/types";
import {
	createLiquidityStore,
	type ILiquidityStore,
	LiquidityMethods,
	LiquidityTypes,
} from ".";

export const LiquidityStoreContext =
	createContext<StoreSubscribeApi<ILiquidityStore> | null>(null);

export const LiquidityProvider: React.FC<PropsWithChildren> = ({
	children,
}) => {
	const storeRef = useRef<StoreSubscribeApi<ILiquidityStore>>(null);
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	const requestedMethod = searchParams.get("method") || LiquidityMethods.ALL;
	const method = requestedMethod === LiquidityMethods.STOCKS && !STOCKS_SECTION_ENABLED
		? LiquidityMethods.ALL
		: requestedMethod;
	const type = searchParams.get("type") || LiquidityTypes.ALL;
	const filter = searchParams.get("filter") || "";

	if (!storeRef.current) {
		storeRef.current = createLiquidityStore({
			method: method as LiquidityMethods,
			type,
			filter,
		});
	}

	if (storeRef.current && storeRef.current.getState().method !== method) {
		storeRef.current.getState().actions.setMethod(method as LiquidityMethods);
	}

	useEffect(() => {
		const subscribe = storeRef.current?.subscribe(
			(state) => [state.method, state.type, state.filter],
			([method, type, filter]) => {
				const params = new URLSearchParams(searchParams.toString());
				method && params.set("method", method);
				type && params.set("type", type);
				filter && params.set("filter", filter);
				router.replace(`${pathname}?${params.toString()}`, { scroll: false });
			},
			{
				equalityFn: shallowEqual,
			},
		);

		return () => {
			subscribe?.();
		};
	}, [router, pathname, searchParams]);

	return (
		<LiquidityStoreContext.Provider value={storeRef.current}>
			{children}
		</LiquidityStoreContext.Provider>
	);
};

export const useLiquidityStore = <T,>(
	selector: (store: ILiquidityStore) => T,
): T => {
	const store = useContext(LiquidityStoreContext);
	if (!store) {
		throw new Error(
			"useLiquidityStore must be used within a LiquidityStoreProvider",
		);
	}
	return useStore(store, selector);
};

export const useLiquidity = <T,>(selector: (store: ILiquidityStore) => T): T =>
	useLiquidityStore(useShallow(selector));

export const useLiquidityActions = () =>
	useLiquidityStore(useShallow((state) => state.actions));
