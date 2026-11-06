"use client";

import {
	createContext,
	type PropsWithChildren,
	useContext,
	useMemo,
	useState,
} from "react";

export enum ClusterNetwork {
	Mainnet = "mainnet-beta",
	Testnet = "testnet",
	Devnet = "devnet",
	Localnet = "localnet",
}

export const CLUSTER_CHAINS = {
	[ClusterNetwork.Mainnet]: 101,
	[ClusterNetwork.Testnet]: 103,
	[ClusterNetwork.Devnet]: 102,
	[ClusterNetwork.Localnet]: 104,
};

// RPC endpoints. The mainnet endpoint MUST be supplied via
// NEXT_PUBLIC_MAINNET_RPC_URL — never hardcode a provider API key here.
// NOTE: any NEXT_PUBLIC_* value is shipped to the browser bundle, so an
// RPC URL configured this way is still visible to end users. For a key
// that must stay secret, proxy RPC calls through a server-side API route
// instead of exposing the provider URL directly to the client.
export const CLUSTER_RPCS = {
	[ClusterNetwork.Mainnet]:
		process.env.NEXT_PUBLIC_RPC_ENDPOINT ||
		process.env.NEXT_PUBLIC_MAINNET_RPC_URL ||
		"https://api.mainnet-beta.solana.com",
	[ClusterNetwork.Testnet]: "https://api.testnet.solana.com",
	[ClusterNetwork.Devnet]:
		process.env.NEXT_PUBLIC_DEVNET_RPC_URL || "https://api.devnet.solana.com",
	[ClusterNetwork.Localnet]: "http://localhost:8899",
};

export interface Cluster {
	endpoint: string;
	network?: ClusterNetwork;
}

export function toWalletAdaperNetwork(
	network: ClusterNetwork,
): ClusterNetwork | undefined {
	switch (network) {
		case ClusterNetwork.Mainnet:
			return ClusterNetwork.Mainnet;
		case ClusterNetwork.Testnet:
			return ClusterNetwork.Testnet;
		case ClusterNetwork.Devnet:
			return ClusterNetwork.Devnet;
		default:
			return ClusterNetwork.Localnet;
	}
}

export interface ClusterProviderContext {
	cluster: Cluster;
	network: ClusterNetwork;
	setNetwork: (network: ClusterNetwork) => void;
}

const ClusterProviderContext = createContext<ClusterProviderContext>(
	{} as ClusterProviderContext,
);

export const ClusterProvider: React.FC<PropsWithChildren> = ({ children }) => {
	const [network, setNetwork] = useState<ClusterNetwork>(
		(process.env.NEXT_PUBLIC_CLUSTER as ClusterNetwork) ||
			ClusterNetwork.Mainnet,
	);

	const cluster = useMemo(
		() => ({
			endpoint: network === ClusterNetwork.Mainnet && process.env.NEXT_PUBLIC_SITE_VARIANT === "main"
				? new URL("/api/solana/mainnet", typeof window === "undefined" ? "https://solve3.fi" : window.location.origin).toString()
				: network === ClusterNetwork.Devnet && process.env.NEXT_PUBLIC_SITE_VARIANT !== "main"
					? new URL("/api/solana/devnet", typeof window === "undefined" ? "https://dev.solve3.fi" : window.location.origin).toString()
					: CLUSTER_RPCS[network],
			network: toWalletAdaperNetwork(network),
		}),
		[network],
	);

	return (
		<ClusterProviderContext.Provider value={{ cluster, setNetwork, network }}>
			{children}
		</ClusterProviderContext.Provider>
	);
};

export const useCluster = (): ClusterProviderContext => {
	const clusterContext = useContext(ClusterProviderContext);
	if (!clusterContext) {
		throw new Error("useCluster must be used within a ClusterProvider");
	}
	return clusterContext;
};

export const useChainId = (): number => {
	const { network } = useCluster();
	return CLUSTER_CHAINS[network];
};
