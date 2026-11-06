import { Stack, Text } from "@mantine/core";
import { TokenBalance } from "@/components/Token/TokenBalance";

export type SwapRouterOutputProps = {
	price?: number | string;
	loading: boolean;
};

export const SwapRouterOutput: React.FC<SwapRouterOutputProps> = ({
	loading,
	price,
}) => {
	return (
		<Stack gap={0}>
			<Text fw="bold" fz={24} lh={1}>
				<TokenBalance value={price} loading={loading} />
			</Text>
			<Text fz="sm" c="success.8" fw={600}>
				<TokenBalance value={0.00123138461} loading={false} />
				<TokenBalance
					value={0.92888}
					loading={false}
					prefix="("
					suffix="%)"
					decimalScale={2}
					fixedDecimalScale={true}
				/>
			</Text>
		</Stack>
	);
};
