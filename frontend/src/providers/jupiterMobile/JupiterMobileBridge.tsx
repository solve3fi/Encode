"use client";

import { useWrappedReownAdapter } from "@jup-ag/jup-mobile-adapter";
import {
	useAppKitAccount,
	useAppKitProvider,
	useAppKitState,
	useDisconnect,
} from "@reown/appkit/react";
import { useAppKitWallet } from "@reown/appkit-wallet-button/react";
import {
	WalletConnectionError,
	WalletNotConnectedError,
} from "@solana/wallet-adapter-base";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useRef } from "react";
import type { JupiterMobileInner } from "./LazyJupiterMobileAdapter";

// Public Reown (WalletConnect) project id. It ships in the page code by design;
// access is limited by the allowed domains set on the project (solve3.fi and
// dev.solve3.fi).
const REOWN_PROJECT_ID =
	process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ||
	"0242d2f7ab759f41b3fb05143327579b";

// How long to wait for Reown to restore an earlier session or to report its wallet list.
const RESTORE_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 8_000;

interface Props {
	name: string;
	description: string;
	iconUrls: string[];
	onReady: (inner: JupiterMobileInner) => void;
}

interface Pending {
	resolve: (publicKey: PublicKey) => void;
	reject: (error: Error) => void;
	/** The AppKit dialog was seen open, so closing it again means "cancelled". */
	sawOpen: boolean;
	silent: boolean;
}

/**
 * Starts Reown AppKit and offers Jupiter Mobile on top of it. Mounted (and its code
 * downloaded) only after someone chooses Jupiter Mobile. Client-only: AppKit must not
 * be created during server rendering.
 *
 * The connect step is written here instead of using the package's own Jupiter adapter:
 * that adapter checks AppKit's state as it was on its first render, which is wrong when
 * AppKit is started on demand (it reports "AppKit adapter closed" and gives up).
 */
const JupiterMobileBridge: React.FC<Props> = ({
	name,
	description,
	iconUrls,
	onReady,
}) => {
	// Starts AppKit and keeps the shared wallet provider (used for signing) in sync.
	const { reownAdapter } = useWrappedReownAdapter({
		appKitOptions: {
			metadata: {
				name,
				description,
				// The origin must match a domain allowed on the Reown project.
				url: window.location.origin,
				icons: iconUrls.map((icon) =>
					new URL(icon, window.location.origin).toString(),
				),
			},
			projectId: REOWN_PROJECT_ID,
			features: { analytics: false, socials: false, email: false },
			enableWallets: false,
			themeMode: "dark",
		},
	});

	const pending = useRef<Pending | null>(null);
	const disconnectListeners = useRef<Array<() => void>>([]);
	const wasConnected = useRef(false);

	const account = useAppKitAccount();
	const appKitState = useAppKitState();
	const { walletProvider } = useAppKitProvider("solana");
	const { disconnect: disconnectAppKit } = useDisconnect();
	const { isReady, connect: openWallet } = useAppKitWallet({
		onError: (error) => {
			console.error("Jupiter Mobile (AppKit):", error);
			const current = pending.current;
			if (current && !current.silent) {
				pending.current = null;
				current.reject(new WalletConnectionError(error.message, error));
			}
		},
	});

	// The package keeps the signing provider in a static field of its adapter class.
	const setSharedProvider = (provider: unknown) =>
		(
			reownAdapter.constructor as unknown as {
				setWalletProvider: (provider: unknown) => void;
			}
		).setWalletProvider(provider);
	const getSharedProvider = () =>
		(reownAdapter.constructor as unknown as { walletProvider: unknown })
			.walletProvider;

	// Resolve a pending connect once AppKit reports an address and the signing provider
	// exists; reject it when the dialog is closed without connecting.
	useEffect(() => {
		const current = pending.current;
		const address = account.isConnected ? account.address : undefined;
		if (address && walletProvider) setSharedProvider(walletProvider);
		if (current) {
			if (address && walletProvider) {
				pending.current = null;
				current.resolve(new PublicKey(address));
			} else if (appKitState.open) {
				current.sawOpen = true;
			} else if (current.sawOpen && !address && !current.silent) {
				pending.current = null;
				current.reject(new WalletConnectionError("Connection cancelled"));
			}
		}
		if (address) {
			wasConnected.current = true;
		} else if (wasConnected.current) {
			wasConnected.current = false;
			setSharedProvider(null);
			for (const listener of disconnectListeners.current) listener();
		}
		// biome-ignore lint/correctness/useExhaustiveDependencies: reacts to AppKit's state only
	}, [account.isConnected, account.address, appKitState.open, walletProvider]);

	// Always read the latest copy of everything the controller touches.
	const latest = useRef({ account, openWallet, disconnectAppKit });
	latest.current = { account, openWallet, disconnectAppKit };

	const controller = useMemo<JupiterMobileInner>(
		() => ({
			connect: (silent = false) =>
				new Promise<PublicKey>((resolve, reject) => {
					const { account, openWallet } = latest.current;
					if (account.isConnected && account.address && getSharedProvider()) {
						return resolve(new PublicKey(account.address));
					}
					pending.current?.reject(new WalletConnectionError("Superseded"));
					pending.current = { resolve, reject, sawOpen: false, silent };
					if (silent) {
						// Restoring an earlier session: wait for it, never open a dialog.
						window.setTimeout(() => {
							if (pending.current?.silent) {
								pending.current = null;
								reject(new WalletNotConnectedError());
							}
						}, RESTORE_TIMEOUT_MS);
					} else {
						void openWallet("jupiter");
					}
				}),
			disconnect: async () => {
				pending.current = null;
				try {
					await latest.current.disconnectAppKit();
				} finally {
					setSharedProvider(null);
				}
			},
			onDisconnect: (listener) => {
				disconnectListeners.current.push(listener);
			},
			sendTransaction: (...args) => reownAdapter.sendTransaction(...args),
			signTransaction: (tx) => reownAdapter.signTransaction(tx),
			signAllTransactions: (txs) => reownAdapter.signAllTransactions(txs),
			signMessage: (message) => reownAdapter.signMessage(message),
		}),
		// biome-ignore lint/correctness/useExhaustiveDependencies: helpers only read refs and a static field
		[reownAdapter],
	);

	// Opening Jupiter needs AppKit's wallet list, which it fetches after it starts. Wait
	// for that (but not forever: the generic AppKit dialog still works).
	useEffect(() => {
		if (isReady) return onReady(controller);
		const timer = window.setTimeout(() => onReady(controller), READY_TIMEOUT_MS);
		return () => window.clearTimeout(timer);
	}, [controller, isReady, onReady]);

	return null;
};

export default JupiterMobileBridge;
