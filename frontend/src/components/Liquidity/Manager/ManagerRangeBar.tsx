import { useLingui } from "@lingui/react";
import { Text } from "@mantine/core";
import type Decimal from "decimal.js";
import classes from "./ManagerRangeBar.module.css";
import { markerPercent } from "./rangeMarker";

export type ManagerRangeBarProps = {
	currentPrice: Decimal | undefined;
	lowerPrice: Decimal | undefined;
	upperPrice: Decimal | undefined;
	/** A bound sits at the pool's price limit (0 or infinity), so there is no linear scale. */
	unbounded: boolean;
	outOfRange: boolean;
};

/** Read-only range bar: shows where the current price sits inside the position's range. */
export const ManagerRangeBar: React.FC<ManagerRangeBarProps> = ({
	currentPrice,
	lowerPrice,
	upperPrice,
	unbounded,
	outOfRange,
}) => {
	const { i18n } = useLingui();
	const percent = unbounded
		? 50
		: markerPercent(currentPrice, lowerPrice, upperPrice);
	// Out of range pins the marker to the edge it crossed, whichever way the price is shown.
	const below =
		currentPrice && lowerPrice ? currentPrice.lt(lowerPrice) : undefined;
	const shown =
		outOfRange && !unbounded && below !== undefined
			? below
				? 0
				: 100
			: percent;
	return (
		<div className={classes.root}>
			<div className={classes.label}>{i18n._("Current price")}</div>
			<div
				className={classes.track}
				role="img"
				aria-label={
					outOfRange
						? i18n._("Current price is outside the position's range")
						: i18n._("Current price is inside the position's range")
				}
			>
				{shown !== undefined && (
					<span
						className={classes.marker}
						data-out={outOfRange || undefined}
						style={{ left: `${shown}%` }}
					/>
				)}
			</div>
			<div className={classes.ends}>
				<span>{i18n._("Min")}</span>
				<span>{i18n._("Max")}</span>
			</div>
			{unbounded && (
				<Text fz="xs" c="gray.4">
					{i18n._("Full range: this position is always in range.")}
				</Text>
			)}
			{outOfRange && (
				<Text fz="xs" className={classes.warn}>
					{i18n._(
						"The current price is outside your range, so this position is not earning fees until the price moves back inside it.",
					)}
				</Text>
			)}
		</div>
	);
};
