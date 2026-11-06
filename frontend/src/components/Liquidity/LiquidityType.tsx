import { useLingui } from "@lingui/react";
import { Percentage } from "@solve3fi/common";
import { useFeeTiers } from "@/hooks/useFeeTiers";
import { LiquidityTypes } from "@/stores/liquidity";
import {
	useLiquidity,
	useLiquidityActions,
} from "@/stores/liquidity/LiquidityProvider";
import classes from "./LiquidityControls.module.css";

/** Fee-tier filter: "all" or one tier's on-chain feeRate. */
export const LiquidityType: React.FC = () => {
	const { i18n } = useLingui();
	const type = useLiquidity((state) => state.type);
	const { setType } = useLiquidityActions();
	const tiers = useFeeTiers();

	return (
		<>
			<label htmlFor="pool-fee-tier" className="visually-hidden" style={{ position: "absolute", left: -9999 }}>
				{i18n._("Fee tier")}
			</label>
			<select
				id="pool-fee-tier"
				className={classes.select}
				value={type}
				onChange={(event) => setType(event.currentTarget.value)}
			>
				<option value={LiquidityTypes.ALL}>{i18n._("All fee tiers")}</option>
				{tiers.map((tier) => (
					<option key={tier.fee} value={String(tier.fee)}>
						{Percentage.fromFraction(tier.fee, 10_000).toDecimal().toString()}%
					</option>
				))}
			</select>
		</>
	);
};
