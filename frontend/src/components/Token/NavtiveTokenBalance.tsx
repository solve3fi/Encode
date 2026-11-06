import type BN from "bn.js";
import { useNativeBalance } from "@/hooks/useNativeBalance";
import { TokenBalance } from "./TokenBalance";

export type NativeTokenBalanceProps = {
	children?: (props: {
		balance: BN | number;
		loading: boolean;
	}) => React.ReactNode;
};

export const NativeTokenBalance: React.FC<NativeTokenBalanceProps> = ({
	children,
}) => {
	const { data, isLoading } = useNativeBalance();

	return children ? (
		children({
			balance: data ?? 0,
			loading: isLoading,
		})
	) : (
		<TokenBalance balance={data ?? 0} loading={isLoading} decimalScale={2} />
	);
};
