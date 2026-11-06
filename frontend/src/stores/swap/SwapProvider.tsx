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
import {
	GENESIS_PUBLIC_ENABLED,
	isGenesisRestrictedTokenMint,
} from "@/configs/genesis";
import { BASE_TOKENS, DEVNET_SOL, DEVNET_USDC } from "@/configs/tokens";
import { useCluster } from "@/providers/ClusterProvider";
import type { StoreSubscribeApi } from "@/types";
import { createSwapStore, Field, type ISwapStore } from ".";

export const SwapStoreContext =
	createContext<StoreSubscribeApi<ISwapStore> | null>(null);

export const SwapProvider: React.FC<
	PropsWithChildren<{ syncUrl?: boolean }>
> = ({ children, syncUrl = true }) => {
	const storeRef = useRef<StoreSubscribeApi<ISwapStore>>(null);
	const { network } = useCluster();
	const searchParams = useSearchParams();
	const pathname = usePathname();

	const from = useMemo(() => {
		const requested = syncUrl ? searchParams.get("from") : null;
		return requested && !isGenesisRestrictedTokenMint(requested)
			? requested
			: // The Swap page opens as SOL -> SOLV3 on devnet. (BASE_TOKENS stays USDC/SOLV3 for the pool pages.)
				network === "devnet"
				? DEVNET_SOL.address
				: BASE_TOKENS[network][0].address;
	}, [searchParams, network, syncUrl]);

	const to = useMemo(() => {
		const defaultTo =
			GENESIS_PUBLIC_ENABLED && network === "devnet"
				? DEVNET_USDC.address
				: BASE_TOKENS[network][1].address;
		const requested = syncUrl ? searchParams.get("to") : null;
		return requested && !isGenesisRestrictedTokenMint(requested)
			? requested
			: defaultTo;
	}, [searchParams, network, syncUrl]);

	const amountParam = syncUrl ? searchParams.get("amount") : null;
	const sideParam = syncUrl ? searchParams.get("side") : null;

	if (!storeRef.current) {
		storeRef.current = createSwapStore({
			from,
			to,
			typedValue: 0,
			independentField: Field.INPUT,
			recipient: undefined,
		});
	}

	// Prefill from the command bar (/swap?from=&to=&amount=&side=out). Runs again when the URL changes while the
	// Swap page is already open, because this provider does not remount on a client-side navigation.
	useEffect(() => {
		const state = storeRef.current?.getState();
		if (!state) return;
		const { setFrom, setTo, setIndependentField, setTypedValue } =
			state.actions;
		if (state.from?.toString() !== from) setFrom(from);
		if (state.to?.toString() !== to) setTo(to);
		const amount = Number(amountParam);
		if (amountParam && Number.isFinite(amount) && amount > 0) {
			setIndependentField(sideParam === "out" ? Field.OUTPUT : Field.INPUT);
			setTypedValue(amount);
		}
	}, [from, to, amountParam, sideParam]);

	useEffect(() => {
		if (!syncUrl) return;
		const subscribe = storeRef.current?.subscribe(
			(state) => [state.from, state.to],
			([from, to]) => {
				const params = new URLSearchParams(searchParams.toString());
				from && params.set("from", from.toString());
				to && params.set("to", to.toString());
				window.history.pushState({}, "", `${pathname}?${params.toString()}`);
			},
			{
				equalityFn: shallowEqual,
			},
		);

		return () => {
			subscribe?.();
		};
	}, [pathname, searchParams, syncUrl]);

	return (
		<SwapStoreContext.Provider value={storeRef.current}>
			{children}
		</SwapStoreContext.Provider>
	);
};

export const useSwapStore = <T,>(selector: (store: ISwapStore) => T): T => {
	const store = useContext(SwapStoreContext);
	if (!store) {
		throw new Error("useSwapStore must be used within a SwapStoreProvider");
	}
	return useStore(store, selector);
};

export const useSwap = <T,>(selector: (store: ISwapStore) => T): T =>
	useSwapStore(useShallow(selector));

export const useSwapActions = () =>
	useSwapStore(useShallow((state) => state.actions));
