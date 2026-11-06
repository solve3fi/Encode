"use client";

import { useLingui } from "@lingui/react";
import { Button, Group, Stack, Text, Tooltip } from "@mantine/core";
import type { Address } from "@solve3fi/common";
import { DecimalUtil } from "@solve3fi/common";
import { IconInfoCircle } from "@tabler/icons-react";
import { useClaimPoolFees } from "@/hooks/useClaimPoolFees";
import { usePoolFeeVaultPosition } from "@/hooks/usePoolFeeVaultPosition";
import { usePoolGaugeStatus } from "@/hooks/usePoolGaugeStatus";
import { usePositionInfo } from "@/hooks/usePositionInfo";
import { useRegisterPoolFeePosition } from "@/hooks/useRegisterPoolFeePosition";
import { useTokens } from "@/hooks/useToken";

export type RewardPoolFeeVaultProps = {
	positionId: Address;
};

// A pool with no active gauge still has its own PoolFeeVault, funded
// whenever an admin/keeper sweeps its protocol fees before a gauge exists
// (see programs/vesolve/src/states/pool_fee_vault.rs). Once a gauge goes
// active this renders nothing — that pool's fees route through the
// native-gauge stream instead, shown elsewhere on this page.
export const RewardPoolFeeVault: React.FC<RewardPoolFeeVaultProps> = ({
	positionId,
}) => {
	const { i18n } = useLingui();
	const { data: position } = usePositionInfo(positionId);
	const poolAddress = position?.getData().solve;
	const positionMint = position?.getData().positionMint;
	const positionAddress = position?.getAddress();

	const { data: gaugeStatus } = usePoolGaugeStatus(poolAddress);
	const { data: vaultData, isLoading } = usePoolFeeVaultPosition(
		poolAddress,
		positionMint,
	);
	const registerMutation = useRegisterPoolFeePosition();
	const claimMutation = useClaimPoolFees();

	const solveData = position?.getSolveData();
	const tokenInfos = useTokens(
		solveData
			? [solveData.tokenMintA.toString(), solveData.tokenMintB.toString()]
			: undefined,
	);
	const [tokenAInfo, tokenBInfo] = tokenInfos ?? [];

	if (!position || !gaugeStatus || gaugeStatus.isActive || isLoading) {
		return null;
	}

	const feePosition = vaultData?.position;
	const accruedA = feePosition?.accruedA;
	const accruedB = feePosition?.accruedB;
	const hasAccrued = Boolean(
		(accruedA && !accruedA.isZero()) || (accruedB && !accruedB.isZero()),
	);

	if (!feePosition) {
		return (
			<Group gap={4} justify="flex-end" wrap="nowrap">
				<Button
					size="xs"
					variant="light"
					loading={registerMutation.isPending}
					onClick={() =>
						poolAddress &&
						positionAddress &&
						positionMint &&
						registerMutation.mutate({
							poolAddress,
							positionAddress,
							positionMint,
						})
					}
				>
					{i18n._("Register for swept fees")}
				</Button>
				<Tooltip
					multiline
					w={240}
					withArrow
					label={i18n._(
						"This pool has no gauge yet. If an admin sweeps its trading fees before one is added, registering lets you claim your share directly.",
					)}
				>
					<IconInfoCircle size={16} style={{ flexShrink: 0 }} />
				</Tooltip>
			</Group>
		);
	}

	return (
		<Stack gap={2} align="flex-end">
			{hasAccrued && (
				<Text fz="xs" c="gray">
					{[
						accruedA && !accruedA.isZero() && tokenAInfo
							? `${DecimalUtil.fromBN(accruedA, tokenAInfo.decimals).toString()} ${tokenAInfo.symbol}`
							: undefined,
						accruedB && !accruedB.isZero() && tokenBInfo
							? `${DecimalUtil.fromBN(accruedB, tokenBInfo.decimals).toString()} ${tokenBInfo.symbol}`
							: undefined,
					]
						.filter(Boolean)
						.join(" + ")}
				</Text>
			)}
			<Button
				size="xs"
				variant="light"
				disabled={!hasAccrued}
				loading={claimMutation.isPending}
				onClick={() =>
					poolAddress &&
					positionAddress &&
					positionMint &&
					solveData &&
					claimMutation.mutate({
						poolAddress,
						positionAddress,
						positionMint,
						tokenMintA: solveData.tokenMintA,
						tokenMintB: solveData.tokenMintB,
					})
				}
			>
				{i18n._("Claim swept fees")}
			</Button>
		</Stack>
	);
};
