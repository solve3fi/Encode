"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fromBaseUnits, toBaseUnits } from "@/lib/intents/amount";
import type { StatusView } from "@/lib/intents/aurora";

export type FundToken = {
	assetId: string;
	symbol: string;
	decimals: number;
	blockchain: string;
	price: number | null;
};

export type FundQuote = {
	amountIn: string;
	amountOut: string;
	minAmountOut?: string;
	amountInUsd?: string;
	amountOutUsd?: string;
	timeEstimate?: number;
	depositAddress?: string;
	depositMemo?: string;
	deadline?: string;
};

export type FundSession = {
	depositAddress: string;
	depositMemo?: string;
	deadline?: string;
	originSymbol: string;
	originChain: string;
	network: string;
	amountIn: string;
	destSymbol: string;
	amountOut: string;
	refundTo: string;
	createdAt: number;
};

export type SwapProgress = {
	status: string;
	view: StatusView;
	details: {
		amountOut: string | null;
		refunded: string | null;
		destinationTx: { hash: string; explorerUrl?: string } | null;
	};
};

const STORAGE_KEY = "solve3-intents-session";

// localStorage can be unavailable (private windows); the feature must still work without it.
export const loadSession = (wallet: string): FundSession | null => {
	try {
		const raw = window.localStorage.getItem(`${STORAGE_KEY}:${wallet}`);
		const session = raw ? (JSON.parse(raw) as FundSession) : null;
		// Never resume something older than a day; it cannot still be pending.
		return session && Date.now() - session.createdAt < 24 * 3600_000
			? session
			: null;
	} catch {
		return null;
	}
};
export const saveSession = (wallet: string, session: FundSession | null) => {
	try {
		if (session)
			window.localStorage.setItem(
				`${STORAGE_KEY}:${wallet}`,
				JSON.stringify(session),
			);
		else window.localStorage.removeItem(`${STORAGE_KEY}:${wallet}`);
	} catch {
		/* ignore */
	}
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const wait = res.headers.get("retry-after");
		throw new Error(
			(body as { error?: string }).error ??
				(res.status === 429 && wait
					? `Too many requests, try again in ${wait}s.`
					: "Something went wrong. Try again."),
		);
	}
	return body as T;
}

export { api };

/** Polls a swap every 8 seconds (Aurora asks for 5-10 s) until it reaches a final state. */
export function useSwapProgress(session: FundSession | null) {
	const [progress, setProgress] = useState<SwapProgress | null>(null);
	const [error, setError] = useState<string | null>(null);
	const stopped = useRef(false);
	const address = session?.depositAddress;
	const memo = session?.depositMemo;

	const refresh = useCallback(async () => {
		if (!address) return;
		try {
			const next = await api<SwapProgress>(
				`/api/intents/status?depositAddress=${encodeURIComponent(address)}${memo ? `&depositMemo=${encodeURIComponent(memo)}` : ""}`,
			);
			setProgress(next);
			setError(null);
			if (next.view.final) stopped.current = true;
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not check status.");
		}
	}, [address, memo]);

	useEffect(() => {
		stopped.current = false;
		setProgress(null);
		if (!address) return;
		void refresh();
		const timer = window.setInterval(() => {
			if (!stopped.current && document.visibilityState !== "hidden")
				void refresh();
		}, 8000);
		return () => window.clearInterval(timer);
	}, [address, refresh]);

	return { progress, error, refresh };
}

/** Debounced indicative quote (dry run): requested once typing stops, never more than every 10 seconds per change. */
export function useDryQuote(args: {
	originAsset?: string;
	destinationAsset?: string;
	amountText: string;
	originDecimals?: number;
	recipient?: string;
	refundTo: string;
	slippageBps: number;
}) {
	const [quote, setQuote] = useState<FundQuote | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const units = useMemo(
		() =>
			args.originDecimals === undefined
				? null
				: toBaseUnits(args.amountText, args.originDecimals),
		[args.amountText, args.originDecimals],
	);
	const ready = Boolean(
		args.originAsset &&
			args.destinationAsset &&
			units &&
			args.recipient &&
			args.refundTo.trim().length > 5,
	);

	useEffect(() => {
		setQuote(null);
		setError(null);
		if (!ready) {
			setLoading(false);
			return;
		}
		setLoading(true);
		const controller = new AbortController();
		const timer = window.setTimeout(async () => {
			try {
				const result = await api<{ quote: FundQuote }>("/api/intents/quote", {
					method: "POST",
					headers: { "content-type": "application/json" },
					signal: controller.signal,
					body: JSON.stringify({
						originAsset: args.originAsset,
						destinationAsset: args.destinationAsset,
						amount: units,
						recipient: args.recipient,
						refundTo: args.refundTo.trim(),
						slippageBps: args.slippageBps,
						dry: true,
					}),
				});
				setQuote(result.quote);
			} catch (e) {
				if (!controller.signal.aborted)
					setError(e instanceof Error ? e.message : "Could not get a quote.");
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		}, 700);
		return () => {
			controller.abort();
			window.clearTimeout(timer);
		};
	}, [
		ready,
		args.originAsset,
		args.destinationAsset,
		units,
		args.recipient,
		args.refundTo,
		args.slippageBps,
	]);

	return { quote, loading, error, units, ready };
}

export { fromBaseUnits };
