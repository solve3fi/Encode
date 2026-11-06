export type NumericInput = number | bigint | string | null | undefined;

const asNumber = (value: NumericInput): number | null => {
	if (value === null || value === undefined || value === "") return null;
	const parsed = typeof value === "bigint" ? Number(value) : Number(value);
	return Number.isFinite(parsed) ? parsed : null;
};

const trimZeros = (value: string) =>
	value.includes(".") ? value.replace(/\.?0+$/, "") : value;

export function formatTokenAmount(
	value: NumericInput,
	options: { decimals?: number; compact?: boolean; dust?: number } = {},
): string {
	const amount = asNumber(value);
	if (amount === null) return "—";
	const decimals = Math.max(0, options.decimals ?? 3);
	const dust = options.dust ?? 10 ** -decimals;
	if (amount !== 0 && Math.abs(amount) < dust) return `<${dust}`;
	if (options.compact) {
		return new Intl.NumberFormat("en-US", {
			notation: "compact",
			maximumFractionDigits: 2,
		}).format(amount);
	}
	return trimZeros(
		new Intl.NumberFormat("en-US", {
			useGrouping: true,
			minimumFractionDigits: 0,
			maximumFractionDigits: decimals,
		}).format(amount),
	);
}

export function formatPercentage(
	value: NumericInput,
	options: { protocolConstant?: boolean } = {},
): string {
	const amount = asNumber(value);
	if (amount === null) return "—";
	return `${new Intl.NumberFormat("en-US", {
		minimumFractionDigits: options.protocolConstant ? 0 : 2,
		maximumFractionDigits: options.protocolConstant ? 0 : 2,
	}).format(amount)}%`;
}

export function formatApr(
	value: NumericInput,
	options: { ceiling?: number } = {},
): string {
	const amount = asNumber(value);
	if (amount === null) return "—";
	if (options.ceiling !== undefined && amount > options.ceiling) {
		return `>${new Intl.NumberFormat("en-US", {
			maximumFractionDigits: 0,
		}).format(options.ceiling)}% APR`;
	}
	return `${formatPercentage(amount)} APR`;
}

export function formatFiat(value: NumericInput): string | null {
	const amount = asNumber(value);
	if (amount === null) return null;
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
}

export function formatAddress(address: string, edge = 4): string {
	if (!address || address.length <= edge * 2 + 1) return address;
	return `${address.slice(0, edge)}…${address.slice(-edge)}`;
}

export function formatDuration(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	const remainder = seconds % 60;
	const clock = [hours, minutes, remainder]
		.map((part) => String(part).padStart(2, "0"))
		.join(":");
	return days > 0 ? `${days}d ${clock}` : clock;
}
