"use client";

import { useLingui } from "@lingui/react";
import { Button, Group, NumberInput, Stack, Text } from "@mantine/core";
import BN from "bn.js";
import Decimal from "decimal.js";
import { useMemo, useState } from "react";
import { useExitFeeConfig } from "@/stores/lock/hooks/useExitFeeConfig";
import { formatAddress, formatTokenAmount } from "@/lib/format";
import { useSetExitPrice } from "@/stores/admin/hooks/useSetExitPrice";
import { useExitConfig } from "@/stores/lock/hooks/useExitConfig";
import { CardLayout } from "../Layout/CardLayout";

const LAMPORTS_PER_SOL = new Decimal(1_000_000_000);

export const AdminExitPrice: React.FC = () => {
	const { i18n } = useLingui();
	const { data: exitConfig, isLoading } = useExitConfig();
	const setExitPrice = useSetExitPrice();
	const { data: feeConfig } = useExitFeeConfig();

	const [solPerSolv3, setSolPerSolv3] = useState<number | string>("");
	const numericRate = typeof solPerSolv3 === "number" ? solPerSolv3 : Number(solPerSolv3) || 0;

	const rawRate = useMemo(() => {
		if (numericRate <= 0) return null;
		try {
			return new BN(new Decimal(numericRate).mul(LAMPORTS_PER_SOL).floor().toFixed(0));
		} catch {
			return null;
		}
	}, [numericRate]);

	const currentRateSol = exitConfig
		? new Decimal(exitConfig.lamportsPerSolv3.toString()).div(LAMPORTS_PER_SOL).toString()
		: null;

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Exit Price")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						`Publishes the SOLV3-per-SOL rate exit_lock charges its ${feeConfig ? feeConfig.feeBps / 100 : "…"}% fee against. SOLV3 has no price feed and its pools carry no liquidity, so this is an administrator input, not an oracle reading — set it to your best estimate of fair value.`,
					)}
				</Text>

				<Group gap="sm">
					<Text c="gray" fz="sm">
						{i18n._("Current rate")}:
					</Text>
					<Text fw={600}>
						{isLoading
							? i18n._("Loading…")
							: currentRateSol
								? `${formatTokenAmount(currentRateSol, { decimals: 9 })} SOL / SOLV3`
								: i18n._("Not set")}
					</Text>
				</Group>
				{exitConfig ? (
					<Text fz="xs" c="gray">
						{i18n._("Last published by")} {formatAddress(exitConfig.updatedBy)}{" "}
						{i18n._("at")}{" "}
						{new Date(exitConfig.updatedAt * 1000).toLocaleString()}
					</Text>
				) : null}

				<Group align="flex-end" gap="sm" wrap="wrap">
					<NumberInput
						label={i18n._("New rate (SOL per SOLV3)")}
						placeholder="0.001"
						min={0}
						decimalScale={9}
						value={solPerSolv3}
						onChange={setSolPerSolv3}
						flex={1}
						miw={220}
					/>
					<Button
						loading={setExitPrice.isPending}
						disabled={!rawRate}
						onClick={() => {
							if (!rawRate) return;
							setExitPrice.mutate({ lamportsPerSolv3: rawRate });
							setSolPerSolv3("");
						}}
					>
						{i18n._("Publish rate")}
					</Button>
				</Group>
			</Stack>
		</CardLayout>
	);
};
