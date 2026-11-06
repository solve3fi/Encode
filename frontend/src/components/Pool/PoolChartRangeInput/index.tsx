import { DecimalUtil } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PoolUtil, PriceMath } from "@solve3fi/sdk";
import { format } from "d3";
import type Decimal from "decimal.js";
import { FeeAmount, PriceInputs } from "@/stores/pool";
import { usePoolActions } from "@/stores/pool/PoolProvider";
import { Chart } from "./Chart";
import "./style.css";
import type { ZoomLevels } from "./types";

export enum Bound {
	LOWER = "LOWER",
	UPPER = "UPPER",
}

const ZOOM_LEVELS: Record<FeeAmount, ZoomLevels> = {
	[FeeAmount.LOWEST]: {
		initialMin: 0.999,
		initialMax: 1.001,
		min: 0.00001,
		max: 1.5,
	},
	// The 0.05% tier hosts volatile pairs such as SOL/USDC: it needs a wide view, not a +/-0.1% stablecoin view.
	[FeeAmount.LOW]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.MEDIUM]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.HIGH]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.LOW_200]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.LOW_300]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.LOW_400]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.HIGH_160]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.HIGH_650]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.HIGH_2000]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.HIGH_3000]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.HIGH_4000]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
	[FeeAmount.HIGH_5000]: {
		initialMin: 0.5,
		initialMax: 2,
		min: 0.00001,
		max: 20,
	},
};

export const PoolChartRangInput = ({
	currencyA,
	currencyB,
	feeAmount,
	ticksAtLimit,
	price,
	interactive,
	priceLower,
	priceUpper,
}: {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	feeAmount?: FeeAmount;
	interactive?: boolean;
	ticksAtLimit: { [_bound in PriceInputs]?: boolean | undefined };
	price: number | undefined;
	priceLower?: Decimal;
	priceUpper?: Decimal;
}) => {
	const { setLowerPrice, setUpperPrice } = usePoolActions();
	const [mintA] =
		currencyA && currencyB
			? PoolUtil.orderMints(currencyA.address, currencyB.address)
			: [undefined, undefined];
	const isSorted =
		currencyA?.address.toLowerCase() === mintA?.toString().toLowerCase();

	const onBrushDomainChangeEnded = (
		domain: [number, number],
		mode: string | undefined,
	) => {
		let leftRangeValue = Number(domain[0]);
		const rightRangeValue = Number(domain[1]);

		if (leftRangeValue <= 0) {
			leftRangeValue = 1 / 10 ** 6;
		}

		if (
			(!ticksAtLimit[isSorted ? PriceInputs.LOWER : PriceInputs.UPPER] ||
				mode === "handle" ||
				mode === "reset") &&
			leftRangeValue > 0
		) {
			setLowerPrice(leftRangeValue);
		}

		if (
			(!ticksAtLimit[isSorted ? PriceInputs.UPPER : PriceInputs.LOWER] ||
				mode === "reset") &&
			rightRangeValue > 0
		) {
			if (rightRangeValue < 1e35) {
				setUpperPrice(rightRangeValue);
			}
		}
	};

	const brushDomain: [number, number] | undefined = (() => {
		try {
			const leftPrice = isSorted
				? priceLower
				: PriceMath.invertPrice(
						priceUpper ?? DecimalUtil.fromNumber(0),
						currencyA?.decimals ?? 8,
						currencyB?.decimals ?? 8,
					);
			const rightPrice = isSorted
				? priceUpper
				: PriceMath.invertPrice(
						priceLower ?? DecimalUtil.fromNumber(0),
						currencyA?.decimals ?? 8,
						currencyB?.decimals ?? 8,
					);

			return leftPrice && rightPrice
				? [
						Number.parseFloat(leftPrice?.toFixed(6)),
						Number.parseFloat(rightPrice?.toFixed(6)),
					]
				: undefined;
		} catch {
			return undefined;
		}
	})();

	const brushLabelValue = (d: "w" | "e", x: number) => {
		if (!price) return "";

		if (
			d === "w" &&
			ticksAtLimit[isSorted ? PriceInputs.LOWER : PriceInputs.UPPER]
		)
			return "0";
		if (
			d === "e" &&
			ticksAtLimit[isSorted ? PriceInputs.UPPER : PriceInputs.LOWER]
		)
			return "∞";

		const percent =
			(x < price ? -1 : 1) *
			((Math.max(x, price) - Math.min(x, price)) / price) *
			100;

		return price
			? `${format(Math.abs(percent) > 1 ? ".2~s" : ".2~f")(percent)}%`
			: "";
	};

	return (
		<Chart
			data={{
				series: [
					{
						activeLiquidity: 10,
						price0: 10,
					},
				],
				current: Number(price),
			}}
			ticksAtLimit={ticksAtLimit}
			dimensions={{ width: 400, height: 176 }}
			margins={{ top: 8, right: 0, bottom: 28, left: 0 }}
			styles={{
				area: {
					selection: "var(--mantine-color-purple-6)",
				},
				brush: {
					handle: {
						west: "var(--mantine-color-purple-6)",
						east: "var(--mantine-color-purple-6)",
					},
				},
			}}
			interactive={interactive}
			brushLabels={brushLabelValue}
			brushDomain={brushDomain}
			onBrushDomainChange={onBrushDomainChangeEnded}
			zoomLevels={ZOOM_LEVELS[feeAmount ?? FeeAmount.MEDIUM]}
		/>
	);
};
