"use client";

import "@/lib/bufferPolyfill";
import {
	AnchorProvider,
	type Wallet as AnchorWallet,
	type Wallet,
} from "@coral-xyz/anchor";
import { buildClient, VeContext } from "@phongjimmy/solve3";
import type {
	Adapter,
	WalletError,
	WalletName,
} from "@solana/wallet-adapter-base";
import {
	ConnectionContext,
	useConnection,
	useWallet,
	WalletProvider,
} from "@solana/wallet-adapter-react";
import type { Cluster, ConnectionConfig, PublicKey } from "@solana/web3.js";
import {
	buildSolveClient,
	type SolveClient,
	SolveContext,
	type SolveContextOpts,
} from "@solve3fi/sdk";
import { type PropsWithChildren, useEffect, useMemo, useState } from "react";
import { PollingConnection } from "@/lib/pollingConnection";
import { ClusterNetwork, useCluster } from "./ClusterProvider";

export const DappProvider: React.FC<PropsWithChildren> = ({ children }) => {
	const { cluster } = useCluster();
	// The Jupiter Wallet Kit captures its `wallets` prop on first render, so the
	// kit provider is only mounted once the official wallet adapters have loaded.
	// Until then the existing `WalletProvider` (standard) renders the same tree
	// so `useWallet()` consumers never run without a context.
	const [wallets, setWallets] = useState<Adapter[]>([]);
	const [walletsReady, setWalletsReady] = useState(false);
	// "Jupiter Mobile" pulls in Reown AppKit, so it loads with the wallet adapters
	// instead of in the main bundle.
	const [KitProvider, setKitProvider] = useState<
		typeof import("./UnifiedWalletWithJupiterMobile").default | null
	>(null);

	useEffect(() => {
		let cancelled = false;

		const loadWallets = async () => {
			const [
				bitget,
				coinbase,
				ledger,
				mathWallet,
				phantom,
				solflare,
				torus,
				trust,
				jupiterMobileKit,
			] = await Promise.all([
					import("@solana/wallet-adapter-bitkeep"),
					import("@solana/wallet-adapter-coinbase"),
					import("@solana/wallet-adapter-ledger"),
					import("@solana/wallet-adapter-mathwallet"),
					import("@solana/wallet-adapter-phantom"),
					import("@solana/wallet-adapter-solflare"),
					import("@solana/wallet-adapter-torus"),
					import("@solana/wallet-adapter-trust"),
					import("./UnifiedWalletWithJupiterMobile"),
				]);

			if (!cancelled) {
				setWallets([
					new bitget.BitgetWalletAdapter(),
					new coinbase.CoinbaseWalletAdapter(),
					new phantom.PhantomWalletAdapter(),
					new solflare.SolflareWalletAdapter(),
					new mathWallet.MathWalletAdapter(),
					new torus.TorusWalletAdapter(),
					new trust.TrustWalletAdapter(),
					new ledger.LedgerWalletAdapter(),
				]);
				setKitProvider(() => jupiterMobileKit.default);
				setWalletsReady(true);
			}
		};

		const startLoading = () => {
			void loadWallets();
		};
		const idleCallback = window.requestIdleCallback?.(startLoading, {
			timeout: 2000,
		});
		const timeout =
			idleCallback === undefined
				? window.setTimeout(startLoading, 0)
				: undefined;

		return () => {
			cancelled = true;
			if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback);
			if (timeout !== undefined) window.clearTimeout(timeout);
		};
	}, []);

	// The Mobile Wallet Adapter (MWA) the Jupiter kit registers only targets
	// Solana clusters; localnet maps to devnet.
	const mwaEnv: Cluster =
		cluster.network === "mainnet-beta" || cluster.network === "testnet"
			? cluster.network
			: "devnet";

	// The Jupiter kit's `config` type (IUnifiedWalletConfig) is not exported from
	// the package root, so the object is typed structurally via the prop.
	const unifiedConfig = useMemo(
		() => ({
			autoConnect: true,
			env: mwaEnv,
			metadata: {
				name: "SOLVE3",
				// NEXT_PUBLIC_SITE_URL wins when set; otherwise fall back to the
				// variant's public host (the main Dockerfile sets SITE_VARIANT=main,
				// the dev Dockerfile does not, so dev defaults to dev.solve3.fi).
				url:
					process.env.NEXT_PUBLIC_SITE_URL ||
					(process.env.NEXT_PUBLIC_SITE_VARIANT === "main"
						? "https://solve3.fi"
						: "https://dev.solve3.fi"),
				description: "SOLVE3 — DEX and liquidity protocol on Solana",
				// Wallet apps show this next to the connection request: it must be square.
				iconUrls: ["/assets/images/wallet-icon.svg"],
			},
			// Backpack is a wallet-standard wallet: the kit lists it automatically
			// when installed, and this entry shows an install link when it is not.
			// Jupiter is offered as "Jupiter Mobile" by UnifiedWalletWithJupiterMobile.
			hardcodedWallets: [
				{
					id: "Backpack",
					name: "Backpack" as WalletName,
					url: "https://backpack.app/downloads",
					icon: "https://backpack.app/favicon.ico",
				},
			],
			theme: "dark" as const,
			lang: "en" as const,
			walletlistExplanation: {
				href: "https://developers.jup.ag/docs/tool-kits/wallet-kit/jupiter-wallet-extension",
			},
		}),
		[mwaEnv],
	);

	// Same settings the stock ConnectionProvider used, but confirmations poll our RPC instead of the public websocket.
	const connectionConfig: ConnectionConfig =
		process.env.NEXT_PUBLIC_SITE_VARIANT === "main"
			? { wsEndpoint: "wss://api.mainnet-beta.solana.com", disableRetryOnRateLimit: true }
			: cluster.network === ClusterNetwork.Devnet
				? { wsEndpoint: "wss://api.devnet.solana.com", disableRetryOnRateLimit: true }
				: { commitment: "confirmed" };
	const wsEndpoint = connectionConfig.wsEndpoint;
	const connection = useMemo(
		() => new PollingConnection(cluster.endpoint, connectionConfig),
		// biome-ignore lint/correctness/useExhaustiveDependencies: the config is fully determined by the endpoint and network
		[cluster.endpoint, wsEndpoint],
	);

	return (
		<ConnectionContext.Provider value={{ connection }}>
			{walletsReady && KitProvider ? (
				<KitProvider wallets={wallets} config={unifiedConfig}>
					{children}
				</KitProvider>
			) : (
				<WalletProvider
					wallets={wallets}
					onError={(error: WalletError) => console.error(error)}
				>
					{children}
				</WalletProvider>
			)}
		</ConnectionContext.Provider>
	);
};

export const useAnchor = (): AnchorProvider => {
	const { connection } = useConnection();
	const wallet = useWallet();
	if (!wallet || connection === undefined) {
		throw new Error("Wallet not connected");
	}

	return new AnchorProvider(connection, wallet as unknown as AnchorWallet, {
		commitment: "confirmed",
	});
};

// Every transaction built through the SDK's TransactionBuilder carries a
// compute-unit limit and a priority fee, so mainnet transactions land before
// their blockhash expires ("block height exceeded"). The fee follows recent
// prioritization fees on the accounts the transaction writes, kept between
// 0.00005 and 0.0002 SOL.
const SOLVE_CONTEXT_OPTS: SolveContextOpts = {
	userDefaultBuildOptions: {
		computeBudgetOption: {
			type: "auto",
			minPriorityFeeLamports: 50_000,
			maxPriorityFeeLamports: 200_000,
		},
	},
};

export const useClient = (
	programId: PublicKey,
): {
	ctx: SolveContext;
	client: SolveClient;
} => {
	const { connection, wallet } = useAnchor();
	const ctx = SolveContext.from(
		connection,
		wallet,
		programId,
		undefined,
		undefined,
		SOLVE_CONTEXT_OPTS,
	);
	return { ctx, client: buildSolveClient(ctx) };
};

export const useVeClient = () => {
	const { connection, wallet } = useAnchor();
	const ctx = VeContext.create(connection, wallet as Wallet);
	return { ctx, client: buildClient(ctx) };
};
