import { useLingui } from "@lingui/react";
import { Button, Stack, Text } from "@mantine/core";
import { Percentage } from "@solve3fi/common";
import type { Position, Solve } from "@solve3fi/sdk";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useClosePosition } from "@/hooks/useClosePosition";
import { useDecreaseLiquidityQuote } from "@/hooks/useDecreaseLiquidityQuote";
import { useDecreasePosition } from "@/hooks/useDecreasePosition";
import { useDerivedBurnInfo } from "@/hooks/useDerivedBurnInfo";
import { useUserSlippageToleranceWithDefault } from "@/hooks/useUserSlippage";
import { ManagerRemovePercent } from "./ManagerRemovePercent";
import { ManagerRemoveReceive } from "./ManagerRemoveReceive";

export type ManagerRemovePanelProps = {
	pool: Solve | null;
	position: Position;
	outOfRange: boolean;
};

export const ManagerRemovePanel: React.FC<ManagerRemovePanelProps> = ({
	position,
	outOfRange,
	pool,
}) => {
	const { i18n } = useLingui();
	const {
		liquidityValue0,
		liquidityValue1,
		token0,
		token1,
		errorMessage,
		liquidityPercentage,
		liquidityAmount,
	} = useDerivedBurnInfo(position);

	const router = useRouter();
	// A 0/0 fraction here (rather than 0/10_000) divides by zero inside the
	// SDK's getSlippageBoundForSqrtPrice (Decimal 0/0 -> NaN -> new BN("NaN")),
	// throwing "Invalid character" — same bug as useDerivedMintInfo.ts.
	const slippageTolerance = useUserSlippageToleranceWithDefault(
		outOfRange
			? Percentage.fromFraction(0, 10_000)
			: Percentage.fromFraction(50, 10_000),
	);

	const { mutateAsync: removePosition, isPending: isRemovePending } =
		useClosePosition();
	const { mutateAsync: decreasePosition, isPending: isDecreasePending } =
		useDecreasePosition();

	const quote = useDecreaseLiquidityQuote(
		liquidityAmount,
		pool?.getData().tickCurrentIndex,
		pool?.getData().sqrtPrice,
		position.getData().tickLowerIndex,
		position.getData().tickUpperIndex,
		slippageTolerance,
		pool?.getData().tokenMintA,
		pool?.getData().tokenMintB,
	);

	const handleRemove = useCallback(async () => {
		if (liquidityPercentage?.toDecimal().eq(1)) {
			await removePosition({
				pool,
				positionAddress: position.getAddress(),
				slippage: slippageTolerance,
			});
			router.push(`/liquidity?method=my-pools&type=all`);
		} else {
			await decreasePosition({
				position,
				quote,
			});
		}
	}, [
		pool,
		liquidityPercentage,
		removePosition,
		decreasePosition,
		position,
		quote,
		slippageTolerance,
		router,
	]);

	return (
		<>
			<Stack gap={12}>
				<Text fz="lg" fw="bold" tt="capitalize">
					{i18n._("Remove Liquidity")}
				</Text>
				<ManagerRemovePercent />
				<ManagerRemoveReceive
					token0={token0}
					token1={token1}
					liquidityValue0={liquidityValue0}
					liquidityValue1={liquidityValue1}
				/>
			</Stack>
			<Button
				fullWidth
				size="lg"
				tt="capitalize"
				disabled={!!errorMessage}
				loading={isRemovePending || isDecreasePending}
				onClick={() => { void handleRemove().catch(() => { /* Mutation displays the wallet/RPC error. */ }); }}
			>
				{errorMessage
					? errorMessage
					: liquidityPercentage?.toDecimal().eq(1)
						? i18n._("Remove Liquidity")
						: i18n._("Decrease Liquidity")}
			</Button>
		</>
	);
};
