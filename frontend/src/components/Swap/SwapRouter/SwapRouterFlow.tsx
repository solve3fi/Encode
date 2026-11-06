import { useLingui } from "@lingui/react";
import { Avatar, Box, Card, Flex, Group, Text } from "@mantine/core";
import type { TokenInfo } from "@solana/spl-token-registry";
import type { TradeRoute } from "@solve3fi/sdk";
import { IconRoute } from "@tabler/icons-react";
import type Decimal from "decimal.js";
import type React from "react";
import { TokenBalance } from "@/components/Token/TokenBalance";
import classes from "./SwapRouterFlow.module.css";
import { SwapRouterNode } from "./SwapRouterNode";

export type SwapRouterFlowProps = {
	from?: TokenInfo | null;
	to?: TokenInfo | null;
	swapAmount: Decimal | undefined;
	swapAmountOut: Decimal | undefined;
	routers: TradeRoute | undefined;
};

export const SwapRouterFlow: React.FC<SwapRouterFlowProps> = ({
	from,
	to,
	swapAmount,
	swapAmountOut,
	routers,
}) => {
	const { i18n } = useLingui();

	return (
		<Card
			shadow="none"
			padding="lg"
			mt={12}
			withBorder={false}
			mih={100}
			bg="transparent"
		>
			<Card.Section>
				<Flex
					h={55}
					bg="purple.9"
					gap={10}
					justify="center"
					align="center"
					style={{ borderRadius: 4 }}
				>
					<IconRoute />
					<Text tt="uppercase" ta="center" fw="bold">
						{i18n._("Trade Router")}
					</Text>
				</Flex>
			</Card.Section>

			<Group h={110} justify="center" align="center">
				<Box pos="relative" h="100%" w="100%" pt={20}>
					<Box className={classes.line} />
					<Group justify="space-between" align="center">
						<Group gap={5}>
							<Avatar src={from?.logoURI} size={24} radius="xl" />
							<Text fw="bold">
								<TokenBalance
									value={swapAmount?.toSignificantDigits(6).toString()}
									loading={false}
									suffix={` ${from?.symbol}`}
								/>
							</Text>
						</Group>
						<Group gap={5}>
							<Text fw="bold">
								<TokenBalance
									value={swapAmountOut?.toSignificantDigits(6).toString()}
									loading={false}
									suffix={` ${to?.symbol}`}
								/>
							</Text>
							<Avatar src={to?.logoURI} size={24} radius="xl" />
						</Group>
					</Group>

					{routers?.subRoutes[0] && (
						<Group
							w="100%"
							gap={20}
							px={20}
							align="center"
							justify="center"
							maw="80%"
							mx="auto"
							className={classes.node}
						>
							{routers?.subRoutes[0]?.path.edges.map(({ poolAddress }) => (
								<SwapRouterNode
									key={poolAddress.toString()}
									poolAddress={poolAddress.toString()}
									splitPercent={routers?.subRoutes[0]?.splitPercent}
								/>
							))}
						</Group>
					)}
				</Box>
			</Group>
		</Card>
	);
};
