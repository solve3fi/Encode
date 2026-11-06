"use client";

import { shallowEqual } from "@mantine/hooks";
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
import { createRewardStore, type IRewardStore, RewardMethods } from ".";

export const RewardStoreContext =
	createContext<StoreSubscribeApi<IRewardStore> | null>(null);

export const RewardProvider: React.FC<PropsWithChildren> = ({ children }) => {
	const storeRef = useRef<StoreSubscribeApi<IRewardStore>>(null);
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	const method = searchParams.get("method") || RewardMethods.LIQUIDITY;
	const filter = searchParams.get("filter") || "";
	const lockId = searchParams.get("lockId") || 0;
	const epoch = searchParams.get("epoch") || 0;

	if (!storeRef.current) {
		storeRef.current = createRewardStore({
			method: method as RewardMethods,
			filter,
			lockId: Number(lockId),
			epoch: +epoch,
		});
	}

	useEffect(() => {
		const subscribe = storeRef.current?.subscribe(
			(state) => [state.method, state.filter, state.lockId, state.epoch],
			([method, filter, lockId, epoch]) => {
				const params = new URLSearchParams(searchParams.toString());
				method && params.set("method", method.toString());
				filter && params.set("filter", filter.toString());
				lockId && params.set("lockId", lockId.toString());
				epoch && params.set("epoch", epoch.toString());
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
		<RewardStoreContext.Provider value={storeRef.current}>
			{children}
		</RewardStoreContext.Provider>
	);
};

export const useRewardStore = <T,>(selector: (store: IRewardStore) => T): T => {
	const store = useContext(RewardStoreContext);
	if (!store) {
		throw new Error("useRewardStore must be used within a RewardStoreProvider");
	}
	return useStore(store, selector);
};

export const useReward = <T,>(selector: (store: IRewardStore) => T): T =>
	useRewardStore(useShallow(selector));

export const useRewardActions = () =>
	useRewardStore(useShallow((state) => state.actions));
