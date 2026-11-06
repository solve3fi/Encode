import type { TokenInfo } from "@solana/spl-token-registry";
import type { Solve } from "@solve3fi/sdk";
import { useToken } from "@/hooks/useToken";

export type LiquidityDataWrapperProps = {
	data?: Solve | null;
	children: (props: {
		record?: Solve | null;
		currencyA?: TokenInfo | null;
		currencyB?: TokenInfo | null;
	}) => React.ReactNode;
};

export const LiquidityDataWrapper: React.FC<LiquidityDataWrapperProps> = ({
	data,
	children,
}) => {
	const currencyA = useToken(data?.getTokenAInfo().address.toString());
	const currencyB = useToken(data?.getTokenBInfo().address.toString());
	return children({
		record: data,
		currencyA,
		currencyB,
	});
};
