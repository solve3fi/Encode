import { useLingui } from "@lingui/react";
import type { TokenInfo } from "@solana/spl-token-registry";
import type BN from "bn.js";
import { Field } from "@/stores/swap";
import { useSwapActions } from "@/stores/swap/SwapProvider";
import { CurrencyBalance } from "../Token/CurrencyBalance";
import { TokenBalance } from "../Token/TokenBalance";
import classes from "./Swap.module.css";
import type { MethodType } from "./SwapCurrency";

const BalanceCustom: React.FC<{
	balance?: number | BN;
	loading: boolean;
	method: MethodType;
}> = ({ balance, loading, method }) => {
	const { i18n } = useLingui();
	const { setTypedValue, setIndependentField } = useSwapActions();
	return (
		<span className={classes.balance}>
			<span>
				{i18n._("Balance")} <TokenBalance balance={balance} loading={loading} />
			</span>
			<button
				type="button"
				className={classes.max}
				onClick={() => {
					setTypedValue(Number(balance));
					setIndependentField(method === "from" ? Field.INPUT : Field.OUTPUT);
				}}
			>
				{i18n._("MAX")}
			</button>
		</span>
	);
};

export const SwapTokenBalance: React.FC<{
	currency: TokenInfo | null;
	method: MethodType;
}> = ({ currency, method }) => (
	<CurrencyBalance currency={currency}>
		{({ balance, loading }) => (
			<BalanceCustom balance={balance} loading={loading} method={method} />
		)}
	</CurrencyBalance>
);
