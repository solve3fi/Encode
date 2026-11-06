"use client";

import { CopyButton, type NumberFormatterProps, Skeleton, Tooltip, UnstyledButton } from "@mantine/core";
import BN from "bn.js";
import { useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import { useDelayedLoading } from "@/hooks/useDelayedLoading";
import classes from "./TokenBalance.module.css";

export type BalanceProps = NumberFormatterProps & {
	loading: boolean;
	balance?: number | BN;
	loadingWidth?: number;
};

export const TokenBalance: React.FC<BalanceProps> = ({
	loading,
	balance,
	loadingWidth = 100,
	value,
	decimalScale,
	prefix = "",
	suffix = "",
}) => {
	const rawValue = value ?? balance;
	const showSkeleton = useDelayedLoading(loading);
	const fullValue = BN.isBN(rawValue) ? rawValue.toString(10) : rawValue === null || rawValue === undefined ? "" : String(rawValue);
	const numericValue = BN.isBN(rawValue) ? rawValue.toNumber() : rawValue;
	const previous = useRef(fullValue);
	const [changed, setChanged] = useState(false);

	useEffect(() => {
		if (previous.current && fullValue && previous.current !== fullValue) {
			setChanged(true);
			const timeout = window.setTimeout(() => setChanged(false), 600);
			previous.current = fullValue;
			return () => window.clearTimeout(timeout);
		}
		previous.current = fullValue;
	}, [fullValue]);

	const display = formatTokenAmount(numericValue as number | string | undefined, {
		decimals: decimalScale ?? 3,
	});
	const unavailable = display === "—";

	return (
		<Skeleton visible={showSkeleton} w={loadingWidth ?? undefined} component="span" className={classes.skeleton}>
			<CopyButton value={fullValue} timeout={1400}>
				{({ copied, copy }) => (
					<Tooltip label={copied ? "Copied full value" : fullValue || "Unknown value"} withArrow>
						<UnstyledButton
							component="span"
							className={`${classes.value} ${changed ? classes.changed : ""} ${copied ? classes.copied : ""}`}
							data-numeric="true"
							onClick={fullValue ? copy : undefined}
							aria-label={fullValue ? `Copy full value ${fullValue}` : "Unknown value"}
						>
							{unavailable ? display : `${prefix}${display}${suffix}`}
						</UnstyledButton>
					</Tooltip>
				)}
			</CopyButton>
		</Skeleton>
	);
};
