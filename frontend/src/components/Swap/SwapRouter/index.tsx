import { Box, Group, Paper, Stack } from "@mantine/core";
import { DecimalUtil } from "@solve3fi/common";
import BN from "bn.js";
import type { BestTrade } from "@/hooks/useBestTrade";
import { useToken } from "@/hooks/useToken";
import { TradeState } from "@/stores/swap";
import { useSwap } from "@/stores/swap/SwapProvider";
import { SwapRouterProvider } from "@/stores/swap-router/SwapRouterProvider";
import { SwapChartType } from "./SwapChartType";
import { SwapChartView } from "./SwapChartView";
import { SwapPriceChart } from "./SwapPriceChart";
import { SwapRouterFlow } from "./SwapRouterFlow";
import { SwapRouterOutput } from "./SwapRouterOutput";
import { SwapTokens } from "./SwapTokens";

export type SwapRouterProps = {
	trade: BestTrade;
};

export const SwapRouter: React.FC<SwapRouterProps> = ({ trade }) => {
	const from = useSwap((state) => state.from);
	const to = useSwap((state) => state.to);

	const baseCurrency = useToken(from.toString());
	const quoteCurrency = useToken(to.toString());

	const swapAmount = DecimalUtil.fromBN(
		trade.routers?.totalAmountIn ?? new BN(0),
		baseCurrency?.decimals,
	);

	const swapAmountOut = DecimalUtil.fromBN(
		trade.routers?.totalAmountOut ?? new BN(0),
		quoteCurrency?.decimals,
	);

	const price = swapAmountOut.div(swapAmount);

	return (
		<SwapRouterProvider>
			<Paper p="md" shadow="sm" bg="var(--mantine-color-dark-10)">
				<Stack gap={15}>
					<Group align="flex-start" justify="space-between">
						<SwapTokens from={baseCurrency} to={quoteCurrency} />
						<SwapChartType />
					</Group>
					<Group align="flex-start" justify="space-between">
						<SwapRouterOutput
							loading={trade.state === TradeState.LOADING}
							price={price.toSignificantDigits(6).toString()}
						/>
						<SwapChartView />
					</Group>
				</Stack>
			</Paper>
			<Box mt={15}>
				<SwapPriceChart />
			</Box>
			<SwapRouterFlow
				from={baseCurrency}
				to={quoteCurrency}
				swapAmount={swapAmount}
				swapAmountOut={swapAmountOut}
				routers={trade.routers}
			/>
		</SwapRouterProvider>
	);
};
