import type { NumberFormatterProps } from "@mantine/core";
import type BN from "bn.js";
import type React from "react";
import { useUSDCPrice } from "@/hooks/useUSDCPrice";
import { TokenBalance } from "./TokenBalance";

export type TokenPriceProps = Omit<NumberFormatterProps, "children"> & {
	addresses: Record<string, number>;
	children?: (props: {
		balance?: number | BN;
		loading: boolean;
	}) => React.ReactNode;
};
export const TokenPrice: React.FC<TokenPriceProps> = ({
	children,
	addresses,
	...props
}) => {
	const { totalUsdcValue, isLoading, isComplete } = useUSDCPrice(addresses);
	const value = isComplete && Object.keys(addresses).length > 0
		? totalUsdcValue.toSignificantDigits(6).toNumber()
		: undefined;

	return children ? (
		children({
			balance: value,
			loading: isLoading,
		})
	) : (
		<TokenBalance
			balance={value}
			loading={isLoading}
			{...props}
		/>
	);
};
