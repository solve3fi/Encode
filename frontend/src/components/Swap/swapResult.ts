import type Decimal from "decimal.js";

export type SwapResultStatus = "pending" | "success" | "failed";

/** Quote-time summary captured when the user presses Swap. */
export type SwapSummary = {
	fromSymbol: string;
	toSymbol: string;
	paid: string;
	got: string;
	/** Percent, signed like the form's Price impact row; null when unknown. */
	impact: number | null;
	/** Estimated network fee in SOL from the quote; replaced by the real fee on confirmation. */
	fee?: number;
};

export type SwapResultData = {
	status: SwapResultStatus;
	summary: SwapSummary;
	signature?: string;
	error?: string;
	/** Real values read from the confirmed transaction when available. */
	fee?: number;
	received?: string;
};

export const formatSwapAmount = (value: Decimal | number | undefined): string => {
	if (value === undefined) return "0";
	const n = typeof value === "number" ? value : Number(value.toString());
	if (!Number.isFinite(n)) return "0";
	return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
};
