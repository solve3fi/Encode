import { useLingui } from "@lingui/react";
import { AddressUtil } from "@solve3fi/common";
import { useMediaQuery } from "@mantine/hooks";
import Link from "next/link";
import { useDerivedMintInfo } from "@/hooks/useDerivedMintInfo";
import { useToken } from "@/hooks/useToken";
import { PriceInputs } from "@/stores/pool";
import { usePool } from "@/stores/pool/PoolProvider";
import { PoolAssetPanel } from "./PoolAssetPanel";
import { PoolHandlePosition } from "./PoolHandlePosition";
import { PoolSummary } from "./PoolSummary";
import { PoolFee } from "./PoolFee";
import { PoolPriceRange } from "./PoolPriceRange";
import { PoolStatus } from "./PoolStatus";
import classes from "./PoolWrapper.module.css";
import { FundNudge } from "@/components/Fund/FundNudge";
import { ArenaPairCard } from "@/components/V2/ArenaPairCard";
import { useState } from "react";

export const PoolWrapper: React.FC = () => {
	const { i18n } = useLingui();
	// Phones show one pane at a time: the pair and fee tier, then the range and deposit.
	const [step, setStep] = useState<"pool" | "range">("pool");

	const currencyA = usePool((state) => state.currencyA);
	const currencyB = usePool((state) => state.currencyB);
	const feeTier = usePool((state) => state.feeTier);

	const baseCurrency = useToken(currencyA.toString());
	const baseBCurrency = useToken(currencyB.toString());

	const quoteCurrency =
		baseCurrency &&
		baseBCurrency &&
		AddressUtil.toPubKey(baseCurrency.address).equals(
			AddressUtil.toPubKey(baseBCurrency.address),
		)
			? undefined
			: baseBCurrency;

	const {
		pricesAtTicks,
		parsedAmounts,
		quote,
		noLiquidity,
		errorMessage,
		outOfRange,
		ticksAtLimit,
		tickCurrentIndex,
		price,
		invertPrice,
		ticks,
		pool,
		poolState,
		inputTokenAmount,
		inputTokenMint,
		slippageTolerance,
	} = useDerivedMintInfo(
		baseCurrency ?? undefined,
		quoteCurrency ?? undefined,
		feeTier,
		baseCurrency ?? undefined,
	);

	const { [PriceInputs.LOWER]: tickLower, [PriceInputs.UPPER]: tickUpper } =
		ticks;
	const { [PriceInputs.LOWER]: priceLower, [PriceInputs.UPPER]: priceUpper } =
		pricesAtTicks;

	const isCreate = Boolean(noLiquidity);
	// Wide layout: the Summary card hosts the action. Narrow: it sits at the bottom of the right panel.
	// Only one instance is ever mounted so the open-position cooldown and pending state stay unique.
	const wide = useMediaQuery("(min-width: 1001px)", false, { getInitialValueInEffect: true });
	const action = (
		<PoolHandlePosition
			currencyA={baseCurrency}
			currencyB={quoteCurrency}
			parsedAmounts={parsedAmounts}
			errorMessage={errorMessage}
			outOfRange={outOfRange}
			noLiquidity={noLiquidity}
			tickLower={tickLower}
			tickUpper={tickUpper}
			quote={quote}
			pool={pool}
			tickCurrentIndex={tickCurrentIndex}
			inputTokenAmount={inputTokenAmount}
			inputTokenMint={inputTokenMint}
			slippageTolerance={slippageTolerance}
		/>
	);

	return (
		<div className={classes.page}>
			<FundNudge when="low" title="Short on SOL or USDC?" text="Add liquidity needs both tokens plus a little SOL for fees." />
			<div className={classes.head}>
				<Link href="/liquidity?method=all" className={classes.back}>
					← {i18n._("All pools")}
				</Link>
				<h1>{isCreate ? i18n._("Create pool") : i18n._("Add liquidity")}</h1>
				<p>
					{isCreate
						? i18n._(
								"Pick a pair and fee tier, set the starting price and your range, then deposit to open the pool.",
							)
						: i18n._(
								"Choose a price range and deposit both tokens to earn trading fees and SOLV3 emissions.",
							)}
				</p>
			</div>
			<div className={classes.steps} role="tablist" aria-label="Add liquidity steps">
				<button type="button" role="tab" aria-selected={step === "pool"} onClick={() => setStep("pool")}><span>1</span> Pool</button>
				<button type="button" role="tab" aria-selected={step === "range"} onClick={() => { setStep("range"); window.scrollTo({ top: 0, behavior: "smooth" }); }}><span>2</span> Range &amp; deposit</button>
			</div>
			<div className={classes.grid} data-step={step}>
				<section className={classes.panel} aria-label={i18n._("Pool setup")}>
					<PoolAssetPanel
						priceLower={priceLower}
						priceUpper={priceUpper}
						invertPrice={invertPrice}
					/>
					<PoolStatus />
					<PoolFee
						baseCurrency={baseCurrency}
						quoteCurrency={quoteCurrency}
						parsedAmounts={parsedAmounts}
						price={price}
						invertPrice={invertPrice}
					/>
					<p className={classes.hint}>
						{i18n._("Token missing?")}{" "}
						<Link href="/liquidity/request-token">{i18n._("Request a token listing")}</Link>
					</p>
					<button type="button" className={classes.cont} onClick={() => { setStep("range"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
						Continue to range
					</button>
					{wide && (
						<PoolSummary
							baseCurrency={baseCurrency}
							quoteCurrency={quoteCurrency}
							isCreate={isCreate}
							priceLower={priceLower}
							priceUpper={priceUpper}
							ticksAtLimit={ticksAtLimit}
							parsedAmounts={parsedAmounts}
						>
							{action}
						</PoolSummary>
					)}
				</section>
				<div className={classes.right}>
					{!isCreate && (
						<div style={{ marginBottom: 16 }}>
							<ArenaPairCard mintA={baseCurrency?.address} mintB={quoteCurrency?.address} feeRate={feeTier} heading="THIS POOL IN THE ARENA" />
						</div>
					)}
					<PoolPriceRange
						baseCurrency={baseCurrency}
						quoteCurrency={quoteCurrency}
						pool={pool}
						poolState={poolState}
						outOfRange={outOfRange}
						noLiquidity={noLiquidity}
						errorMessage={errorMessage}
						quote={quote}
						parsedAmounts={parsedAmounts}
						tickLower={tickLower}
						tickUpper={tickUpper}
						priceLower={priceLower}
						priceUpper={priceUpper}
						ticksAtLimit={ticksAtLimit}
						price={price}
						invertPrice={invertPrice}
						feeTier={feeTier}
						tickCurrentIndex={tickCurrentIndex}
						inputTokenAmount={inputTokenAmount}
						inputTokenMint={inputTokenMint}
						slippageTolerance={slippageTolerance}
						hideAction={wide}
					/>
				</div>
			</div>
		</div>
	);
};
