import { ClusterNetwork } from "@/providers/ClusterProvider";

export const WALLET_DOCS_URL =
	"https://solana.com/ecosystem/explore?categories=wallet";

export const getExpolerUrl = (
	network: ClusterNetwork,
	address?: string,
	method: "tx" | "address" = "address",
) => {
	switch (network) {
		case ClusterNetwork.Testnet:
			return `https://solscan.io/${method}/${address}?cluster=testnet`;
		case ClusterNetwork.Devnet:
			return `https://solscan.io/${method}/${address}?cluster=devnet`;
		default:
			return `https://solscan.io/${method}/${address}`;
	}
};
