import { useLingui } from "@lingui/react";
import {
	Flex,
	Group,
	Paper,
	rem,
	Stack,
	Text,
} from "@mantine/core";
import { DecimalUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import type { Position } from "@solve3fi/sdk";
import BN from "bn.js";
import { TokenPrice } from "@/components/Token/TokenPrice";
import { TokenBalance } from "@/components/Token/TokenBalance";
import { usePositionFeesQuote } from "@/hooks/usePositionFeesQuote";

export type ManagerPositionFeeProps = {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	position?: Position;
};

export const ManagerPositionFee: React.FC<ManagerPositionFeeProps> = ({
	currencyA,
	currencyB,
	position,
}) => {
	const { i18n } = useLingui();
	const { data: fees, isLoading, isError } = usePositionFeesQuote(position);
	const ready = !isError && fees?.[0] !== undefined && fees?.[1] !== undefined;
	return (
		<Paper p="md" shadow="sm">
			<Flex
				gap={12}
				justify="space-between"
				direction={{ base: "column", md: "row" }}
			>
				<Flex
					gap={4}
					direction={{ base: "row", md: "column" }}
					justify="space-between"
				>
					<Text fz="sm" c="gray.10" fw={600}>
						{i18n._("Unclaimed fees")}
					</Text>
					<Text fz={rem(24)} fw={600}>
						<TokenPrice
							addresses={
								ready && currencyA && currencyB
									? {
											[currencyA?.address]: DecimalUtil.fromBN(
												new BN(fees?.[0] || 0),
												currencyA?.decimals,
											).toNumber(),
											[currencyB?.address]: DecimalUtil.fromBN(
												new BN(fees?.[1] || 0),
												currencyB?.decimals,
											).toNumber(),
										}
									: {}
							}
							prefix="$"
							decimalScale={2}
						/>
					</Text>
				</Flex>

				<Stack gap={8}>
					<Group justify="space-between">
						<Text fz="md" c="gray.4" fw={600}>
							{currencyA?.symbol} {i18n._("Fees Earned:")}
						</Text>
						<Text fz="md" fw={600}>
							<TokenBalance
								loading={isLoading}
								value={ready ? DecimalUtil.fromBN(
									new BN(fees?.[0] || 0),
									currencyA?.decimals ?? 0,
								).toString() : undefined}
								decimalScale={9}
							/>
						</Text>
					</Group>

					<Group justify="space-between">
						<Text fz="md" c="gray.4" fw={600}>
							{currencyB?.symbol} {i18n._("Fees Earned:")}
						</Text>
						<Text fz="md" fw={600}>
							<TokenBalance
								loading={isLoading}
								value={ready ? DecimalUtil.fromBN(
									new BN(fees?.[1] || 0),
									currencyB?.decimals ?? 0,
								).toString() : undefined}
								decimalScale={9}
							/>
						</Text>
					</Group>
				</Stack>
			</Flex>
		</Paper>
	);
};
