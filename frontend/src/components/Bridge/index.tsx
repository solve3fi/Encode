"use client";
import { useLingui } from "@lingui/react";
import { Group, Image, Stack, Text, Title } from "@mantine/core";
import { BridgeAmountIn } from "./BridgeAmountIn";
import { BridgeAmountOut } from "./BridgeAmountOut";

import { BridgeSwapAmount } from "./BridgeSwapAmount";
import { BridgeSwapButton } from "./BridgeSwapButton";
import { BridgeTradeRoute } from "./BridgeTradeRoute";

export const Bridge: React.FC = () => {
	const { i18n } = useLingui();

	return (
		<Stack gap={24}>
			<Title fz={36} fw={600}>
				{i18n._("Bridge")}
			</Title>

			<Stack>
				<BridgeAmountIn />
				<BridgeSwapAmount />
				<BridgeAmountOut />
			</Stack>

			<BridgeTradeRoute />
			<BridgeSwapButton />
			<Group justify="center" gap={8}>
				<Text span fz={14} fw={600} c="gray.21">
					{i18n._("Powered by")}
				</Text>
				<Image src="/assets/partners/wormhole.svg" alt="brand" />
			</Group>
		</Stack>
	);
};
