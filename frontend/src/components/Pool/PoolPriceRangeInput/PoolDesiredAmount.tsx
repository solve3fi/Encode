import { useLingui } from "@lingui/react";
import {
	Box,
	Group,
	NumberInput,
	Paper,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { DecimalUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { JupiterPriceFeed } from "@/components/PriceFeeds/JupiterPriceFeed";
import { useOtherFeeTierPrice } from "@/hooks/useOtherFeeTierPrice";
import { formatPercentage } from "@/lib/format";
import { DEFAULT_SLIPPAGE } from "@/stores/application";
import { useApplication } from "@/stores/application/ApplicationProvider";
import type { FeeAmount } from "@/stores/pool";
import { usePoolActions } from "@/stores/pool/PoolProvider";
import classes from "./PoolDesiredAmount.module.css";

export type PoolDesiredAmountProps = {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	desiredAmount: number;
	existPool: boolean;
	feeAmount?: FeeAmount;
};

export const PoolDesiredAmount: React.FC<PoolDesiredAmountProps> = ({
	currencyA,
	currencyB,
	desiredAmount,
	existPool,
	feeAmount,
}) => {
	const { i18n } = useLingui();
	const { setDesiredAmount } = usePoolActions();
	const slippage = useApplication((state) => state.slippage);
	const otherTierPrice = useOtherFeeTierPrice(
		currencyA ?? undefined,
		currencyB ?? undefined,
		feeAmount,
	);

	return (
		!existPool && (
			<Stack gap={4}>
				<Text fz="lg" fw="bold">
					{i18n._("Set Starting Price")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"This pool doesn't exist yet. Enter the price it should launch at — this sets the initial exchange rate and can't be changed afterwards.",
					)}
				</Text>

				<Group align="center" justify="space-between" gap={40} mt={8}>
					<Text>
						{i18n._("Starting")}{" "}
						<Text span inherit>
							{currencyB?.symbol}{" "}
						</Text>
						<Text span inherit>
							{i18n._("Price")}
						</Text>
					</Text>

					<Box flex={1}>
						<NumberInput
							size="lg"
							placeholder="0.00"
							hideControls
							fw="bold"
							thousandSeparator=","
							decimalSeparator="."
							fixedDecimalScale
							rightSection={
								<Text>
									{currencyB?.symbol}{" "}
									<Text span inherit>
										{i18n._("per")}{" "}
									</Text>
									<Text span inherit>
										{currencyA?.symbol}
									</Text>
								</Text>
							}
							rightSectionWidth={250}
							classNames={classes}
							autoFocus={desiredAmount === 0}
							value={desiredAmount.toString()}
							onChange={(value) => setDesiredAmount(Number(value))}
						/>
					</Box>
				</Group>
				{desiredAmount === 0 && (
					<Text fz="xs" c="orange.5">
						{i18n._(
							"Enter a starting price above before depositing — it's currently empty.",
						)}
					</Text>
				)}

				{otherTierPrice ? (
					<Paper p="md" shadow="sm" bg="dark.10">
						<Group justify="space-between" wrap="nowrap">
							<Text fz="sm">
								{i18n._(
									"Already trades at {price} {symbol} in solve3's {feeTier} pool",
									{
										price: otherTierPrice.price
											.toSignificantDigits(6)
											.toString(),
										symbol: currencyB?.symbol,
										feeTier: formatPercentage(
											otherTierPrice.feeAmount / 10_000,
										),
									},
								)}
							</Text>
							<UnstyledButton
								fz="sm"
								onClick={() =>
									setDesiredAmount(otherTierPrice.price.toNumber())
								}
							>
								{i18n._("Use this price")}
							</UnstyledButton>
						</Group>
					</Paper>
				) : (
					<JupiterPriceFeed
						inputMint={currencyA}
						outputMint={currencyB}
						amount={DecimalUtil.toBN(
							DecimalUtil.fromNumber(1),
							currencyA?.decimals,
						)}
						slippage={slippage === "auto" ? DEFAULT_SLIPPAGE : slippage * 100}
						onUsePrice={setDesiredAmount}
					/>
				)}
			</Stack>
		)
	);
};
