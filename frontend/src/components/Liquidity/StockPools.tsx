import { useLingui } from "@lingui/react";
import { Button } from "@mantine/core";
import { IconChartCandle, IconArrowLeft } from "@tabler/icons-react";
import Link from "next/link";
import { STOCK_ASSETS } from "@/configs/stockAssets";
import { useChainId, useCluster, ClusterNetwork } from "@/providers/ClusterProvider";
import { LiquidityMethods, LiquidityTypes } from "@/stores/liquidity";
import { useLiquidityActions } from "@/stores/liquidity/LiquidityProvider";
import { LiquidityLists } from "./LiquidityLists";
import classes from "./StockPools.module.css";

export const StockPools = () => {
	const { i18n } = useLingui();
	const chainId = useChainId();
	const { network } = useCluster();
	const { setMethod } = useLiquidityActions();
	const hasStockAssets = STOCK_ASSETS.some((asset) => asset.chainId === chainId);
	const isTesting = network !== ClusterNetwork.Mainnet;

	return (
		<section className={classes.root} aria-labelledby="stock-pools-title">
			<header className={classes.heading}>
				<div>
					<p className={classes.eyebrow}>{i18n._("Tokenized equities")}</p>
					<h2 id="stock-pools-title">{i18n._("Stock pools")}</h2>
					<p className={classes.description}>{i18n._("A dedicated place for liquidity in tokenized stocks, separate from other crypto assets.")}</p>
				</div>
				<span className={classes.badge}>{hasStockAssets ? i18n._("Stocks") : i18n._("Not yet available")}</span>
			</header>

			{hasStockAssets ? <LiquidityLists type={LiquidityTypes.ALL} stocksOnly /> : (
				<div className={classes.empty} role="status">
					<div className={classes.icon} aria-hidden="true"><IconChartCandle size={30} stroke={1.5} /></div>
					<h3>{i18n._("No stock pools listed yet")}</h3>
					<p>{i18n._("No stock assets are enabled on this network. Pools will appear here once issuer assets and their integrations have been reviewed and enabled.")}</p>
					<Button variant="light" mih={44} leftSection={<IconArrowLeft size={16} />} onClick={() => setMethod(LiquidityMethods.ALL)}>
						{i18n._("Browse all pools")}
					</Button>
				</div>
			)}

			<footer className={classes.notice}>
				<p>{isTesting ? i18n._("Test network only. No real shares are offered here; test tokens have no monetary value.") : i18n._("Availability depends on your jurisdiction and the issuer's eligibility requirements.")}</p>
				<Link href="/legal">{i18n._("Read asset disclosures")}</Link>
			</footer>
		</section>
	);
};
