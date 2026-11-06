"use client";

import { UnifiedWalletProvider } from "@jup-ag/wallet-adapter";
import type { Adapter } from "@solana/wallet-adapter-base";
import {
	createContext,
	lazy,
	memo,
	type PropsWithChildren,
	type ReactNode,
	Suspense,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type JupiterMobileInner,
	LazyJupiterMobileAdapter,
} from "./jupiterMobile/LazyJupiterMobileAdapter";

// Reown AppKit (what Jupiter Mobile runs on) is large and makes network requests on
// start, so it is a separate chunk that only loads once Jupiter Mobile is chosen.
const JupiterMobileBridge = lazy(
	() => import("./jupiterMobile/JupiterMobileBridge"),
);

// The kit does not export its config type from the package root.
type UnifiedWalletConfig = React.ComponentProps<
	typeof UnifiedWalletProvider
>["config"];

// The kit calls `registerMwa` (the Solana Mobile Wallet Adapter) in its render body, and
// wallet-standard keeps every registration, so each time the kit re-renders Android
// visitors get one more "Mobile Wallet Adapter" in the list. Keep the kit from re-rendering:
// it is memoized, and the page content reaches it through a context instead of as changing
// `children` props.
const StableKit = memo(UnifiedWalletProvider);
const ChildrenContext = createContext<ReactNode>(null);
const ChildrenOutlet = () => useContext(ChildrenContext);

interface Props extends PropsWithChildren {
	wallets: Adapter[];
	config: UnifiedWalletConfig;
}

/**
 * Wraps the Jupiter wallet kit and adds "Jupiter Mobile" (opens the Jupiter app on a
 * phone, QR code on desktop) to the wallet list. Only rendered on the client, after the
 * other adapters have loaded: the kit reads its `wallets` prop only once, on first render.
 */
const UnifiedWalletWithJupiterMobile: React.FC<Props> = ({
	wallets,
	config,
	children,
}) => {
	const [bridgeMounted, setBridgeMounted] = useState(false);
	const innerRef = useRef<JupiterMobileInner | null>(null);
	const waiters = useRef<Array<(adapter: JupiterMobileInner) => void>>([]);

	const onReady = useCallback((adapter: JupiterMobileInner) => {
		innerRef.current = adapter;
		for (const resolve of waiters.current.splice(0)) resolve(adapter);
	}, []);

	// One element for the life of the component, or `memo` would see new props every time.
	const outlet = useMemo(() => <ChildrenOutlet />, []);

	const allWallets = useMemo(
		() => [
			...wallets,
			new LazyJupiterMobileAdapter(
				() =>
					new Promise<JupiterMobileInner>((resolve) => {
						if (innerRef.current) return resolve(innerRef.current);
						waiters.current.push(resolve);
						setBridgeMounted(true);
					}),
			),
		],
		// biome-ignore lint/correctness/useExhaustiveDependencies: the kit captures its wallet list on first render, so it must stay stable.
		[],
	);

	return (
		<>
			<ChildrenContext.Provider value={children}>
				<StableKit wallets={allWallets} config={config}>
					{outlet}
				</StableKit>
			</ChildrenContext.Provider>
			{/* Outside the kit on purpose: mounting it must not re-render the kit. */}
			{bridgeMounted ? (
				<Suspense fallback={null}>
					<JupiterMobileBridge
						name={config.metadata.name}
						description={config.metadata.description}
						iconUrls={config.metadata.iconUrls}
						onReady={onReady}
					/>
				</Suspense>
			) : null}
		</>
	);
};

export default UnifiedWalletWithJupiterMobile;
