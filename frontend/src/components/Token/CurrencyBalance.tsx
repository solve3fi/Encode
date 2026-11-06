import { AddressUtil, DecimalUtil, TokenUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import type BN from "bn.js";
import { useAllTokenBalances } from "@/hooks/useCurrencyBalanace";
import { NativeTokenBalance } from "./NavtiveTokenBalance";
import { TokenBalance } from "./TokenBalance";

export type CurrencyBalanceProps = {
	currency?: TokenInfo | null;
	children?: (props: {
		balance: BN | number;
		loading: boolean;
	}) => React.ReactNode;
};

export const CurrencyBalance: React.FC<CurrencyBalanceProps> = ({
	currency,
	children,
}) => {
	const { data, isFetching } = useAllTokenBalances();

	if (
		currency &&
		TokenUtil.isNativeMint(AddressUtil.toPubKey(currency.address))
	) {
		return <NativeTokenBalance>{children}</NativeTokenBalance>;
	}

	return children ? (
		children({
			balance:
				currency && data?.[currency.address]
					? DecimalUtil.fromBN(
							data[currency.address],
							currency.decimals,
						).toNumber()
					: 0,
			loading: isFetching,
		})
	) : (
		<TokenBalance
			balance={
				currency && data?.[currency.address]
					? DecimalUtil.fromBN(
							data[currency.address],
							currency.decimals,
						).toNumber()
					: 0
			}
			loading={isFetching}
			decimalScale={2}
		/>
	);
};
