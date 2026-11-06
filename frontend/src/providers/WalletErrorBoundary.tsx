"use client";

import { Button, Stack, Text, Title } from "@mantine/core";
import { Component, type PropsWithChildren } from "react";

type WalletErrorBoundaryState = {
	hasError: boolean;
};

// @solana/wallet-adapter-react's WalletProvider constructs a Solana Mobile
// Wallet Adapter the moment it detects an Android browser, which throws
// ("createDefaultAddressSelector is not a function") due to a webpack
// module-resolution bug in a transitive dependency chain that couldn't be
// fixed via aliasing (see next.config.ts) — every real mobile visitor hit a
// blank white-screen crash before this boundary existed. This can't recover
// by re-rendering the same tree (the crash is deterministic on that browser),
// so the fallback offers a reload rather than silently retrying.
export class WalletErrorBoundary extends Component<
	PropsWithChildren,
	WalletErrorBoundaryState
> {
	state: WalletErrorBoundaryState = { hasError: false };

	static getDerivedStateFromError(): WalletErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: unknown) {
		console.error("WalletErrorBoundary caught:", error);
	}

	render() {
		if (this.state.hasError) {
			return (
				<Stack align="center" justify="center" gap="sm" mih="100vh" p="xl">
					<Title order={3}>Something went wrong loading the wallet connector</Title>
					<Text c="dimmed" ta="center">
						This browser hit an error setting up wallet support. Reloading
						usually fixes it.
					</Text>
					<Button onClick={() => window.location.reload()}>Reload</Button>
				</Stack>
			);
		}

		return this.props.children;
	}
}
