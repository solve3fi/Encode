"use client";

import type { PropsWithChildren } from "react";
import { createConfig, http, WagmiProvider } from "wagmi";
import { mainnet } from "wagmi/chains";
// Import the injected connector's own subpath, not the "wagmi/connectors"
// barrel — that barrel statically imports every connector's SDK (Coinbase,
// MetaMask, WalletConnect, Safe...), which fails to resolve for the ones
// we haven't installed since we only want injected/EIP-6963 detection.
import { injected } from "wagmi/connectors/injected";

// The Airdrop flow only ever asks the EVM wallet to sign a message (proving
// address ownership) — it never sends a transaction or reads chain state —
// so a single default chain/transport is enough; nothing here is chain-specific.
export const wagmiConfig = createConfig({
	chains: [mainnet],
	connectors: [injected()],
	transports: {
		[mainnet.id]: http(),
	},
});

export const EvmWalletProvider: React.FC<PropsWithChildren> = ({
	children,
}) => <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>;
