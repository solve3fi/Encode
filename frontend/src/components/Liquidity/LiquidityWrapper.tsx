import { useLingui } from "@lingui/react";
import Link from "next/link";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { STOCKS_SECTION_ENABLED } from "@/configs/stockAssets";
import { LiquidityMethods } from "@/stores/liquidity";
import { useLiquidity } from "@/stores/liquidity/LiquidityProvider";
import { LiquidityFilter } from "./LiquidityFilter";
import { LiquidityLists } from "./LiquidityLists";
import { LiquidityMethod } from "./LiquidityMethod";
import { LiquidityMyLists } from "./LiquidityMyLists";
import { LiquidityType } from "./LiquidityType";
import classes from "./LiquidityControls.module.css";
import { StockPools } from "./StockPools";

export const LiquidityWrapper: React.FC = () => {
	const { i18n } = useLingui();
	const method = useLiquidity((state) => state.method);
	const type = useLiquidity((state) => state.type);
	const isStocks = STOCKS_SECTION_ENABLED && method === LiquidityMethods.STOCKS;
	const Heading = GENESIS_PUBLIC_ENABLED ? "h2" : "h1";

	return (
		<div style={{ maxWidth: 1240, margin: "0 auto", padding: "24px 24px 48px", display: "flex", flexDirection: "column", gap: 32 }}>
			<div className={classes.heading}>
				<div className={classes.headingText}>
					<Heading>{i18n._("Liquidity pools")}</Heading>
					<p>
						{i18n._(
							"Add liquidity to concentrated pools on Solana. Weekly votes decide which pools earn SOLV3 emissions.",
						)}
					</p>
				</div>
				{!isStocks && (
					<div className={classes.actions}>
						<Link href="/liquidity/create" className={classes.primary}>
							{i18n._("Create pool")}
						</Link>
						<Link href="/liquidity/request-token" className={classes.secondary}>
							{i18n._("Request token listing")}
						</Link>
					</div>
				)}
			</div>

			<div className={classes.controls}>
				<LiquidityMethod />
				{!isStocks && (
					<>
						<LiquidityType />
						<LiquidityFilter />
					</>
				)}
			</div>

			{isStocks ? (
				<StockPools />
			) : method !== LiquidityMethods.MY_POOLS ? (
				<LiquidityLists type={type} />
			) : (
				<LiquidityMyLists type={type} />
			)}
		</div>
	);
};
