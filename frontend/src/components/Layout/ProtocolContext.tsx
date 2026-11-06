"use client";

import { usePathname } from "next/navigation";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { DEX_ONLY } from "@/configs/launchPhase";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { WeeklyChecklist } from "@/components/ProtocolHome/WeeklyChecklist";
import classes from "./AppLayout.module.css";

/**
 * The ve(3,3) explainer strip that used to sit above every page was removed: it pushed content down and repeated what the
 * home page and the Arena already say. Only the weekly checklist remains, on the pools page.
 */
export function ProtocolContext() {
	const pathname = usePathname();
	const { network } = useCluster();
	if (!pathname?.endsWith("/liquidity") || network !== ClusterNetwork.Devnet || DEX_ONLY || GENESIS_PUBLIC_ENABLED) return null;
	return (
		<div className={classes.flywheelDisclosure}>
			<WeeklyChecklist />
		</div>
	);
}
