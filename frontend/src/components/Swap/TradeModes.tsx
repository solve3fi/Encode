"use client";

import { Tabs } from "@mantine/core";
import { useState } from "react";
import { Fund } from "@/components/Fund";
import { INTENTS_ENABLED } from "@/configs/intents";
import { Swap } from ".";
import classes from "./Swap.module.css";

export function TradeModes({
	initialMode = "swap",
}: {
	initialMode?: "swap" | "bridge";
}) {
	const [mode, setMode] = useState<string>(initialMode);
	const [openedBridge, setOpenedBridge] = useState(initialMode === "bridge");
	const fromFund = initialMode === "bridge";

	if (!INTENTS_ENABLED) {
		return fromFund ? <Fund /> : <Swap />;
	}

	return (
		<Tabs
			value={mode}
			onChange={(value) => {
				if (!value) return;
				if (value === "bridge") setOpenedBridge(true);
				setMode(value);
			}}
			className={classes.tradeModes}
		>
			<Tabs.List aria-label="Trade mode" grow className={classes.modeList}>
				<Tabs.Tab value="swap">Swap</Tabs.Tab>
				<Tabs.Tab value="bridge">Bridge</Tabs.Tab>
			</Tabs.List>
			<Tabs.Panel value="swap">
				<Swap syncUrl={!fromFund} />
			</Tabs.Panel>
			<Tabs.Panel value="bridge">
				{openedBridge && <Fund embedded useUrlPrefill={fromFund} />}
			</Tabs.Panel>
		</Tabs>
	);
}
