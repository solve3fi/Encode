import { DecimalUtil } from "@solve3fi/common";
import type Decimal from "decimal.js";
import { PriceInputs } from "@/stores/pool";

export function formatTickPrice(
	price: Decimal | undefined,
	atLimit: { [bound in PriceInputs]?: boolean | undefined },
	direction: PriceInputs,
	placeholder?: string,
): string {
	if (atLimit[direction]) {
		return direction === PriceInputs.LOWER ? "0" : "∞";
	}

	if (!price && placeholder !== undefined) {
		return placeholder;
	}

	return DecimalUtil.fromNumber(price?.toNumber() ?? 0)
		.toSignificantDigits(6)
		.toString();
}
