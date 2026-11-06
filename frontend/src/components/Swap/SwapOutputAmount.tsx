"use client";

import { useLingui } from "@lingui/react";
import { Flex, Group, NumberFormatter, Text } from "@mantine/core";
import { DecimalUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { IconRefresh } from "@tabler/icons-react";
import type Decimal from "decimal.js";
import classes from "./SwapOutputAmount.module.css";

export type SwapOutputAmountProps = {
	from?: TokenInfo | null;
	to?: TokenInfo | null;
	swapAmountIn?: Decimal;
	swapAmountOut?: Decimal;
	loading?: boolean;
};

export const SwapOutputAmount: React.FC<SwapOutputAmountProps> = ({
	from,
	to,
	swapAmountIn,
	swapAmountOut,
	loading,
}) => {
	const { i18n } = useLingui();

	if (!from || !to) return null;

	return (
		<Group gap={5} align="center">
			<Text size="sm" c="gray">
				{i18n._("Price")}
			</Text>

			<Group gap={5} maw={"90%"}>
				<Text c="success.8" fw={600}>
					<NumberFormatter
						value={1}
						suffix={` ${from?.symbol}`}
						thousandSeparator=","
						decimalSeparator="."
						decimalScale={4}
					/>
				</Text>
				<Text c="success.8" fw={600}>
					=
				</Text>
				<Text c="success.8" fw={600}>
					<NumberFormatter
						value={swapAmountOut
							?.div(swapAmountIn ?? DecimalUtil.fromNumber(0))
							?.toString()}
						suffix={` ${to?.symbol}`}
						thousandSeparator=","
						decimalSeparator="."
						decimalScale={4}
					/>
				</Text>
			</Group>

			<Flex className={classes.refreshicon} mod={{ loading }} align="center">
				<IconRefresh
					size={16}
					color="var(--mantine-color-purple-9)"
					stroke={2}
				/>
			</Flex>
		</Group>
	);
};
