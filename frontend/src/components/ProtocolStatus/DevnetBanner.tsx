"use client";

import { Anchor, Container } from "@mantine/core";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { StatusChip } from "./StatusChip";
import classes from "./DevnetBanner.module.css";

export const DevnetBanner = () => {
	const { network } = useCluster();
	if (network !== ClusterNetwork.Devnet) return null;

	return (
		<div className={classes.root} role="status">
			<Container size="xl" className={classes.inner}>
				<StatusChip tone="devnet" pulse>
					Devnet
				</StatusChip>
				<span className={classes.message}>
					Protocol sandbox · Tokens have no monetary value
				</span>
				<Anchor
					href="https://faucet.solana.com/"
					target="_blank"
					rel="noopener noreferrer"
					className={classes.link}
				>
					Get test SOL ↗
				</Anchor>
			</Container>
		</div>
	);
};
