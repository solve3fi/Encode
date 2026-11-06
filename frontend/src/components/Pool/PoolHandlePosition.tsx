import { useLingui } from "@lingui/react";
import { Alert, Button, Stack } from "@mantine/core";
import { AddressUtil, type Percentage } from "@solve3fi/common";
import type { TokenInfo } from "@solana/spl-token-registry";
import {
	type IncreaseLiquidityQuote,
	type Solve,
	TokenExtensionUtil,
	increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage,
} from "@solve3fi/sdk";
import type BN from "bn.js";
import type Decimal from "decimal.js";
import { useRouter } from "next/navigation";
import {
	type PropsWithChildren,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID } from "@/configs/addresses";
import { useAllPositions } from "@/hooks/useAllPositions";
import { useCreatePool } from "@/hooks/useCreatePool";
import { useIncreasePosition } from "@/hooks/useIncreasePosition";
import { useOpenPosition } from "@/hooks/useOpenPosition";
import { usePositions } from "@/hooks/usePositions";
import { useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import type { Field } from "@/stores/pool";

// If the wallet's position list hasn't picked up a just-minted position yet
// (RPC/query staleness), the existingPosition check above can't see it, so a
// fast second submit -- a double-click, or the user just retrying because
// nothing visibly happened yet -- could still open a genuine duplicate. Lock
// out another mint for a short buffer after any successful one from this
// panel, independent of whether the position list has caught up.
const MINT_COOLDOWN_MS = 20_000;

export type PoolHandleMintProps = {
	currencyA?: TokenInfo | null;
	currencyB?: TokenInfo | null;
	parsedAmounts?: { [field in Field]?: Decimal };
	errorMessage?: React.ReactNode;
	pool: Solve | null;
	tickLower?: number;
	tickUpper?: number;
	quote?: IncreaseLiquidityQuote;
	outOfRange?: boolean;
	noLiquidity?: boolean;
	tickCurrentIndex?: number;
	inputTokenAmount?: BN;
	inputTokenMint?: string;
	// Only needed on the "create pool" path (noLiquidity=true), to recompute
	// a fresh quote against the just-created pool. Callers that only ever
	// open/increase a position on an existing pool (e.g. ManagerAddPanel)
	// don't need to pass this.
	slippageTolerance?: Percentage;
};

export const PoolHandlePosition: React.FC<
	PropsWithChildren<PoolHandleMintProps>
> = ({
	currencyA,
	currencyB,
	errorMessage,
	outOfRange,
	noLiquidity,
	pool,
	tickLower,
	tickUpper,
	quote,
	tickCurrentIndex,
	inputTokenAmount,
	inputTokenMint,
	slippageTolerance,
	children,
}) => {
	const { i18n } = useLingui();
	const { network } = useCluster();
	const { client, ctx } = useClient(DEX_PROGRAM_ID[network]);
	const router = useRouter();

	const { mutateAsync: createPool, isPending: isPoolPending } = useCreatePool();
	const { mutateAsync: openPosition, isPending: isPositionPending } =
		useOpenPosition();
	const { mutateAsync: increasePosition, isPending: isIncreasePending } =
		useIncreasePosition();

	// A pair+fee-tier pool can only ever be initialized once (the on-chain PDA
	// already prevents that), but nothing previously stopped this same "New
	// Pools" flow from happily minting a second, third, ... brand new position
	// with the exact same range in an already-existing pool -- which reads as
	// "duplicate pools" in My Pools even though it's really duplicate
	// positions. If the wallet already holds a position in this pool with
	// this exact range, add to it instead of minting another one.
	const { data: myPositionAddresses } = useAllPositions();
	const { data: myPositions } = usePositions(myPositionAddresses);
	const existingPosition = useMemo(() => {
		if (!pool || typeof tickLower !== "number" || typeof tickUpper !== "number")
			return undefined;
		const poolAddress = pool.getAddress().toString();
		return myPositions?.find((position) => {
			const data = position.getData();
			return (
				data.solve.toString() === poolAddress &&
				data.tickLowerIndex === tickLower &&
				data.tickUpperIndex === tickUpper
			);
		});
	}, [pool, tickLower, tickUpper, myPositions]);

	const [lastMintedAt, setLastMintedAt] = useState<number | null>(null);
	const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);

	useEffect(() => {
		if (!lastMintedAt) return;
		const tick = () =>
			setCooldownRemainingMs(
				Math.max(0, MINT_COOLDOWN_MS - (Date.now() - lastMintedAt)),
			);
		tick();
		const interval = setInterval(tick, 500);
		return () => clearInterval(interval);
	}, [lastMintedAt]);

	const inCooldown = cooldownRemainingMs > 0;

	const handleCreatePool = useCallback(async () => {
		const poolKey = await createPool({
			tokenMintA: currencyA,
			tokenMintB: currencyB,
			tickCurrentIndex,
		});

		if (!poolKey) return;
		const freshPool = await client.getPool(poolKey);
		if (!freshPool) return;

		// The `quote` prop was computed before this pool existed, against a
		// client-side fallback price/tick derived from the desired starting
		// price — not the pool's real on-chain state. Recompute it fresh
		// against the just-created pool so liquidity math (and the tick
		// arrays/position instructions built from it) reflect reality,
		// rather than reusing a stale pre-creation estimate.
		let freshQuote = quote;
		if (
			typeof tickLower === "number" &&
			typeof tickUpper === "number" &&
			inputTokenAmount &&
			inputTokenMint &&
			slippageTolerance
		) {
			const freshData = freshPool.getData();
			const tokenExtensionCtx =
				await TokenExtensionUtil.buildTokenExtensionContextForPool(
					ctx.fetcher,
					freshData.tokenMintA,
					freshData.tokenMintB,
				);
			freshQuote = increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage({
				inputTokenMint: AddressUtil.toPubKey(inputTokenMint),
				tokenMintA: freshData.tokenMintA,
				tokenMintB: freshData.tokenMintB,
				inputTokenAmount,
				tickCurrentIndex: freshData.tickCurrentIndex,
				sqrtPrice: freshData.sqrtPrice,
				tickLowerIndex: tickLower,
				tickUpperIndex: tickUpper,
				slippageTolerance,
				tokenExtensionCtx,
			});
		}

		if (!freshQuote || !freshQuote.liquidityAmount || freshQuote.liquidityAmount.isZero()) {
			notification.error({
				title: i18n._("Open Position"),
				message: i18n._(
					"Pool created, but the deposit amount is too small for this price range — increase the amount or widen the range, then add liquidity from My Pools.",
				),
			});
			router.push(`/liquidity?method=my-pools&type=all`);
			return;
		}

		await openPosition({
			pool: freshPool,
			quote: freshQuote,
			tickLower,
			tickUpper,
		});
		router.push(`/liquidity?method=my-pools&type=all`);
	}, [
		createPool,
		currencyA,
		currencyB,
		tickCurrentIndex,
		openPosition,
		quote,
		tickLower,
		tickUpper,
		inputTokenAmount,
		inputTokenMint,
		slippageTolerance,
		client,
		ctx,
		i18n,
		router,
	]);

	const handleSubmit = useCallback(async () => {
		try {
			if (noLiquidity) {
				await handleCreatePool();
			} else if (existingPosition) {
				await increasePosition({ position: existingPosition, quote });
			} else {
				await openPosition({ pool, quote, tickLower, tickUpper });
			}
			setLastMintedAt(Date.now());
		} catch {
			// The mutation hooks already surface their own error notification.
		}
	}, [
		noLiquidity,
		handleCreatePool,
		existingPosition,
		increasePosition,
		quote,
		openPosition,
		pool,
		tickLower,
		tickUpper,
	]);

	return (
		<Stack gap="sm">
			{outOfRange && errorMessage === undefined && (
				<Alert color="yellow" variant="light">
					{i18n._(
						"This range doesn't include the current price — it's a valid single-sided position, but it won't earn fees or emissions until the price moves into range.",
					)}
				</Alert>
			)}
			{existingPosition && errorMessage === undefined && (
				<Alert color="blue" variant="light">
					{i18n._(
						"You already have a position with this exact range in this pool — depositing will add to it instead of opening a duplicate.",
					)}
				</Alert>
			)}
			{inCooldown && errorMessage === undefined && (
				<Alert color="blue" variant="light">
					{i18n._(
						"Just minted a position here — briefly pausing before allowing another, so a duplicate can't slip through before your positions list catches up.",
					)}
				</Alert>
			)}
			<Button
				loading={isPoolPending || isPositionPending || isIncreasePending}
				disabled={errorMessage !== undefined || inCooldown}
				fullWidth
				size="lg"
				onClick={handleSubmit}
			>
				{errorMessage
					? errorMessage
					: inCooldown
						? i18n._("Please wait ({seconds}s)", {
								seconds: Math.ceil(cooldownRemainingMs / 1000),
							})
						: noLiquidity
							? i18n._("Create Pool")
							: existingPosition
								? i18n._("Add to Existing Position")
								: (children ?? i18n._("Open Position"))}
			</Button>
		</Stack>
	);
};
