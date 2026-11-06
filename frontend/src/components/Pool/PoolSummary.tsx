import { useLingui } from "@lingui/react";
import { Percentage } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import { PoolUtil, PriceMath } from "@solve3fi/sdk";
import type Decimal from "decimal.js";
import type { ReactNode } from "react";
import { Field, PriceInputs } from "@/stores/pool";
import { usePool } from "@/stores/pool/PoolProvider";
import classes from "./PoolSummary.module.css";

export type PoolSummaryProps = {
	baseCurrency?: TokenInfo | null;
	quoteCurrency?: TokenInfo | null;
	isCreate: boolean;
	priceLower?: Decimal;
	priceUpper?: Decimal;
	ticksAtLimit: { [bound in PriceInputs]?: boolean | undefined };
	parsedAmounts?: { [field in Field]?: Decimal };
	/** The existing open-position / connect-wallet action, rendered under the rows. */
	children?: ReactNode;
};

const digits = (value: Decimal | undefined) =>
	value ? value.toSignificantDigits(5).toString() : undefined;

/** Left-column summary of the pair, tier, range and deposit; reads the same state the form edits. */
export const PoolSummary: React.FC<PoolSummaryProps> = ({
	baseCurrency,
	quoteCurrency,
	isCreate,
	priceLower,
	priceUpper,
	ticksAtLimit,
	parsedAmounts,
	children,
}) => {
	const { i18n } = useLingui();
	const feeTier = usePool((state) => state.feeTier);
	const desiredAmount = usePool((state) => state.desiredAmount);

	// Same orientation rule as the Min/Max price boxes: prices are stored for the sorted mint order.
	const [mintA] =
		baseCurrency && quoteCurrency
			? PoolUtil.orderMints(baseCurrency.address, quoteCurrency.address)
			: [undefined];
	const isSorted =
		baseCurrency?.address.toLowerCase() === mintA?.toString().toLowerCase();
	const invert = (value: Decimal | undefined) => {
		if (!value || value.isZero() || !baseCurrency || !quoteCurrency)
			return undefined;
		try {
			return PriceMath.invertPrice(
				value,
				baseCurrency.decimals,
				quoteCurrency.decimals,
			);
		} catch {
			return undefined;
		}
	};
	const left = isSorted ? priceLower : invert(priceUpper);
	const right = isSorted ? priceUpper : invert(priceLower);
	const fullRange =
		Boolean(ticksAtLimit[PriceInputs.LOWER]) &&
		Boolean(ticksAtLimit[PriceInputs.UPPER]);

	const range = fullRange
		? i18n._("Full range")
		: left && right
			? `${digits(left)} – ${ticksAtLimit[PriceInputs.UPPER] ? "∞" : digits(right)}`
			: "—";

	const amounts = Object.values(parsedAmounts ?? {}).filter(
		(value) => value && !value.isZero(),
	);
	const deposit =
		baseCurrency && quoteCurrency && amounts.length
			? [
					[baseCurrency, parsedAmounts?.[Field.CURRENCY_A]],
					[quoteCurrency, parsedAmounts?.[Field.CURRENCY_B]],
				]
					.filter(([, value]) => value && !(value as Decimal).isZero())
					.map(
						([token, value]) =>
							`${(value as Decimal).toSignificantDigits(6).toString()} ${(token as TokenInfo).symbol}`,
					)
					.join(" + ")
			: "—";

	const rows: [string, string][] = [
		[
			i18n._("Pair"),
			baseCurrency && quoteCurrency
				? `${baseCurrency.symbol} / ${quoteCurrency.symbol}`
				: "—",
		],
		[
			i18n._("Fee tier"),
			`${Percentage.fromFraction(Number(feeTier), 10_000).toDecimal().toString()}%`,
		],
		...(isCreate
			? ([
					[
						i18n._("Starting price"),
						desiredAmount > 0
							? `${desiredAmount} ${quoteCurrency?.symbol ?? ""} ${i18n._("per")} ${baseCurrency?.symbol ?? ""}`
							: i18n._("Not set"),
					],
				] as [string, string][])
			: []),
		[i18n._("Price range"), range],
		[i18n._("Deposit"), deposit],
		[i18n._("Network fee"), i18n._("Paid in SOL")],
	];

	return (
		<div className={classes.card} data-testid="pool-summary">
			<h2>{i18n._("SUMMARY")}</h2>
			{rows.map(([label, value]) => (
				<div className={classes.row} key={label}>
					<span>{label}</span>
					<b>{value}</b>
				</div>
			))}
			<div className={classes.rule} />
			{children}
			<p>
				{i18n._(
					"Review your pair, fee tier and range before you confirm. A price range nobody has used yet creates new tick arrays, which cost about 0.05 SOL of one-time rent each.",
				)}
			</p>
		</div>
	);
};
