import { useState } from "react";
import { GenesisProgressPanel } from "@/components/Genesis/GenesisCampaignPanels";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { useDerivedSwapInfo } from "@/hooks/useDerivedSwapInfo";
import { RefreshAmount } from "./RefreshAmount";
import { SlippagePanel, SlippageToggle } from "./Slippage";
import { SwapAssetPanel } from "./SwapAssetPanel";
import classes from "./Swap.module.css";

export const SwapWrapper: React.FC = () => {
	const [settingsOpen, setSettingsOpen] = useState(false);
	const {
		allowedSlippage,
		currencies,
		parsedAmount,
		recipientAddress,
		trade,
		inputError,
		isExactIn,
	} = useDerivedSwapInfo();

	return (
		<div className={classes.page}>
			<div className={classes.heading}>
				<h1>Swap</h1>
				<p>Trade Solana tokens through Solve3&apos;s concentrated-liquidity pools.</p>
			</div>
			<section aria-label="Swap" className={classes.card}>
				<div className={classes.cardHead}>
					<span className={classes.cardTitle}>Trade</span>
					<div className={classes.iconRow}>
						<RefreshAmount />
						<SlippageToggle
							open={settingsOpen}
							onToggle={() => setSettingsOpen((open) => !open)}
						/>
					</div>
				</div>
				{settingsOpen && <SlippagePanel />}
				<SwapAssetPanel
					trade={trade}
					allowedSlippage={allowedSlippage}
					parsedAmount={parsedAmount}
					currencies={currencies}
					recipientAddress={recipientAddress}
					swapInputError={inputError}
					isExactIn={isExactIn}
				/>
			</section>
			{GENESIS_PUBLIC_ENABLED && <GenesisProgressPanel />}
		</div>
	);
};
