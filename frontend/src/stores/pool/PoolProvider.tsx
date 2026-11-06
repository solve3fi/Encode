"use client";

import { shallowEqual } from "@mantine/hooks";
import { usePathname, useSearchParams } from "next/navigation";
import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { ALMS } from "@/configs/alms";
import {
	GENESIS_PUBLIC_ENABLED,
	isGenesisRestrictedTokenMint,
} from "@/configs/genesis";
import { BASE_TOKENS, DEVNET_USDC } from "@/configs/tokens";
import { usePoolRanges } from "@/hooks/usePoolRanges";
import { useCluster } from "@/providers/ClusterProvider";
import type { StoreSubscribeApi } from "@/types";
import {
	createPoolStore,
	FeeAmount,
	Field,
	type IPoolStore,
	PoolTypes,
} from ".";

export const PoolStoreContext =
	createContext<StoreSubscribeApi<IPoolStore> | null>(null);

export const PoolProvider: React.FC<PropsWithChildren> = ({ children }) => {
	const storeRef = useRef<StoreSubscribeApi<IPoolStore>>(null);
	const { network } = useCluster();
	const searchParams = useSearchParams();
	const ranges = usePoolRanges();
	const pathname = usePathname();

	const currencyA = useMemo(() => {
		const requested = searchParams.get("currencyA");
		return requested && !isGenesisRestrictedTokenMint(requested)
			? requested
			: BASE_TOKENS[network][0].address;
	}, [searchParams, network]);

	const currencyB = useMemo(() => {
		const defaultCurrency =
			GENESIS_PUBLIC_ENABLED && network === "devnet"
				? DEVNET_USDC.address
				: BASE_TOKENS[network][1].address;
		const requested = searchParams.get("currencyB");
		return requested && !isGenesisRestrictedTokenMint(requested)
			? requested
			: defaultCurrency;
	}, [searchParams, network]);

	const feeTier = useMemo(
		() => searchParams.get("fee") ?? FeeAmount.HIGH,
		[searchParams],
	);

	const poolType = useMemo(
		// Splash (automatic) pools are retired; every pool is a concentrated pool.
		() => PoolTypes.MANUAL,
		[],
	);

	if (!storeRef.current) {
		storeRef.current = createPoolStore({
			currencyA,
			currencyB,
			poolType: poolType as PoolTypes,
			range: ranges[0],
			typedValue: 0,
			independentField: Field.CURRENCY_A,
			alm: ALMS[0],
			feeTier: feeTier as FeeAmount,
			desiredAmount: 0,
			lowerPrice: true,
			upperPrice: true,
		});
	}

	useEffect(() => {
		const subscribe = storeRef.current?.subscribe(
			(state) => [
				state.currencyA,
				state.currencyB,
				state.poolType,
				state.feeTier,
			],
			([currencyA, currencyB, poolType, feeTier]) => {
				const params = new URLSearchParams(searchParams.toString());
				currencyA && params.set("currencyA", currencyA.toString());
				currencyB && params.set("currencyB", currencyB.toString());
				poolType && params.set("poolType", poolType.toString());
				feeTier && params.set("fee", feeTier.toString());
				window.history.pushState({}, "", `${pathname}?${params.toString()}`);
			},
			{
				equalityFn: shallowEqual,
			},
		);

		return () => {
			subscribe?.();
		};
	}, [pathname, searchParams]);

	return (
		<PoolStoreContext.Provider value={storeRef.current}>
			{children}
		</PoolStoreContext.Provider>
	);
};

export const usePoolStore = <T,>(selector: (store: IPoolStore) => T): T => {
	const store = useContext(PoolStoreContext);
	if (!store) {
		throw new Error("usePoolStore must be used within a PoolStoreProvider");
	}
	return useStore(store, selector);
};

export const usePool = <T,>(selector: (store: IPoolStore) => T): T =>
	usePoolStore(useShallow(selector));

export const usePoolActions = () =>
	usePoolStore(useShallow((state) => state.actions));
