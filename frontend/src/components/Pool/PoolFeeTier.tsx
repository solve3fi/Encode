import { useLingui } from "@lingui/react";
import {
	Paper,
	SimpleGrid,
	Stack,
	Text,
	UnstyledButton,
} from "@mantine/core";
import { Percentage } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PriceMath } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import { useEffect } from "react";
import { useEnabledFeeTiers } from "@/hooks/useEnabledFeeTiers";
import { useFeeTiers } from "@/hooks/useFeeTiers";
import { useFeeTierShares } from "@/hooks/useFeeTierShares";
import { usePool, usePoolActions } from "@/stores/pool/PoolProvider";
import classes from "./PoolFeeTier.module.css";

export type PoolFeeTierProps = {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	price: Decimal | undefined;
	invertPrice: boolean;
};

export const PoolFeeTier: React.FC<PoolFeeTierProps> = ({
	currencyA,
	currencyB,
	price,
	invertPrice,
}) => {
	const { i18n } = useLingui();
	const feeTier = usePool((state) => state.feeTier);
	const { setFeeTier } = usePoolActions();
	const range = usePool((state) => state.range);
	const { setLowerPrice, setUpperPrice } = usePoolActions();
	const fees = useFeeTiers();
	const { data: enabled } = useEnabledFeeTiers();
	const { data: shares } = useFeeTierShares();
	const isEnabled = (spacing: number) => !enabled || enabled.has(spacing);

	// Fall back to a tier that exists when the current one is not enabled here.
	useEffect(() => {
		if (!enabled || enabled.size === 0) return;
		const current = fees.find((item) => item.fee === Number(feeTier));
		if (current && enabled.has(current.tickSpacing)) return;
		const next =
			fees.find((item) => item.fee === 3000 && enabled.has(item.tickSpacing)) ??
			fees.find((item) => enabled.has(item.tickSpacing));
		if (next) setFeeTier(next.fee);
	}, [enabled, feeTier, fees, setFeeTier]);

	const handleSetFeeTier = (feeTier: number) => {
		if (!price) return;

		setFeeTier(feeTier);
		if (range.demission === null) {
			setLowerPrice(true);
			setUpperPrice(true);
			return;
		}

		const newPriceLower = price.div(range.demission.toDecimal());
		const newPriceUpper = price.mul(range.demission.toDecimal());

		if (invertPrice) {
			setLowerPrice(
				PriceMath.invertPrice(
					newPriceUpper,
					currencyA?.decimals ?? 8,
					currencyB?.decimals ?? 8,
				)
					.toSignificantDigits(8)
					.toNumber(),
			);
			setUpperPrice(
				PriceMath.invertPrice(
					newPriceLower,
					currencyA?.decimals ?? 8,
					currencyB?.decimals ?? 8,
				)
					.toSignificantDigits(8)
					.toNumber(),
			);
			return;
		}

		setLowerPrice(newPriceLower.toNumber());
		setUpperPrice(newPriceUpper.toNumber());
	};

	return (
		<Stack>
			<Text fz="sm" fw={600} c="gray" lts="0.06em">
				{i18n._("FEE TIER")}{" "}
				<Text span inherit fw={500} lts={0}>
					· {i18n._("share of pools using each tier")}
				</Text>
			</Text>
			<SimpleGrid
				cols={{
					base: 3,
					sm: 4,
				}}
				spacing={10}
			>
				{fees.map((item) => {
					const selected = Number(feeTier) === item.fee;
					const usable = isEnabled(item.tickSpacing);
					const share = shares?.share(item.fee);
					return (
						<UnstyledButton
							key={item.fee}
							disabled={!usable}
							aria-pressed={selected}
							title={usable ? undefined : i18n._("Not enabled on this network yet")}
							style={usable ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
							onClick={() => handleSetFeeTier(item.fee)}
						>
							<Paper
								px="md"
								py="sm"
								withBorder
								mod={{ selected }}
								className={classes.item}
							>
								<Stack gap={8}>
									<Text fz={20} fw={700} lh={1.2}>
										{item.featured && "🔥 "}
										{Percentage.fromFraction(item.fee, 10_000)
											.toDecimal()
											.toString()}
										%
									</Text>
									<Stack gap={5}>
										<span className={classes.usage}>
											<span
												className={classes.usageBar}
												data-selected={selected || undefined}
												style={{ width: `${Math.max(share ?? 0, 3)}%` }}
											/>
										</span>
										<Text fz={11.5} fw={600} c="cyan.4">
											{share === undefined ? "—" : `${share}%`}
										</Text>
									</Stack>
								</Stack>
							</Paper>
						</UnstyledButton>
					);
				})}
			</SimpleGrid>
		</Stack>
	);
};
