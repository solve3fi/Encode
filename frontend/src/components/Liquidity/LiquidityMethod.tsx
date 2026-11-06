"use client";

import { useLingui } from "@lingui/react";
import { STOCKS_SECTION_ENABLED } from "@/configs/stockAssets";
import { LiquidityMethods } from "@/stores/liquidity";
import {
	useLiquidity,
	useLiquidityActions,
} from "@/stores/liquidity/LiquidityProvider";
import classes from "./LiquidityControls.module.css";

export const LiquidityMethod: React.FC = () => {
	const { i18n } = useLingui();
	const method = useLiquidity((state) => state.method);
	const { setMethod } = useLiquidityActions();

	const tabs: Array<{ value: LiquidityMethods; label: string }> = [
		{ value: LiquidityMethods.ALL, label: i18n._("All pools") },
		...(STOCKS_SECTION_ENABLED
			? [{ value: LiquidityMethods.STOCKS, label: i18n._("Stocks") }]
			: []),
		{ value: LiquidityMethods.MY_POOLS, label: i18n._("My pools") },
	];

	return (
		<div className={classes.tabs} role="group" aria-label={i18n._("Pool category")}>
			{tabs.map((tab) => (
				<button
					key={tab.value}
					type="button"
					className={classes.tab}
					aria-pressed={method === tab.value}
					onClick={() => setMethod(tab.value)}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
};
