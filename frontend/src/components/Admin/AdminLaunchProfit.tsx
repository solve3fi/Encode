"use client";

import {
	Badge,
	Button,
	Group,
	NumberInput,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import {
	AddressUtil,
	Percentage,
	type TransactionBuilder,
} from "@solve3fi/common";
import { useWallet } from "@solana/wallet-adapter-react";
import { type PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
	getAllPositionAccountsByOwner,
	IGNORE_CACHE,
	increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage,
	PDAUtil,
	PoolUtil,
	PriceMath,
	type Solve,
	TokenExtensionUtil,
} from "@solve3fi/sdk";
import BN from "bn.js";
import { useCallback, useMemo, useState } from "react";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { DEVNET_USDC_MINT } from "@/configs/devnetFaucet";
import { SOL, USDC } from "@/configs/tokens";
import type { DeployPlan } from "@/lib/launchLadderDeploy";
import {
	allPassed,
	type Check,
	checkAddLiquidity,
	classifyPosition,
	type PositionStatus,
	rangeAroundTick,
	splitUsdc,
} from "@/lib/launchLadderProfit";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { TICK_SPACINGS } from "@/stores/pool";
import { CardLayout } from "../Layout/CardLayout";

const USDC_DECIMALS = 6;
const SOL_RESERVE_LAMPORTS = 50_000_000; // never wrap the last 0.05 SOL
const LIQUIDITY_REL_TOLERANCE = 1e-6;
// Closing a filled position should return at least this share of the USDC
// the position data says it holds (the rest being rounding).
const WITHDRAW_MIN_SHARE = 0.999;

type LadderPosition = {
	address: string;
	tickLower: number;
	tickUpper: number;
	status: PositionStatus;
	usdc: bigint;
	solv3: bigint;
};

type ScanState = {
	poolTick: number;
	positions: LadderPosition[];
	walletUsdc: bigint;
};

type PoolOption = {
	tickSpacing: number;
	address: PublicKey;
	liquidity: string;
};

const fmtUsdc = (raw: bigint) =>
	(Number(raw) / 10 ** USDC_DECIMALS).toLocaleString(undefined, {
		maximumFractionDigits: 2,
	});

const Checks: React.FC<{ title: string; checks: Check[] }> = ({
	title,
	checks,
}) => (
	<Stack gap={4}>
		<Text fz="sm" fw="bold">
			{title}
		</Text>
		{checks.map((c) => (
			<Group key={c.label} gap="xs" wrap="nowrap" align="flex-start">
				<Badge size="xs" color={c.ok ? "green" : "red"} variant="light">
					{c.ok ? "PASS" : "FAIL"}
				</Badge>
				<Text fz="xs" style={{ wordBreak: "break-word" }}>
					{c.label}
					<Text span c="gray" fz="xs">
						{" "}
						— {c.detail}
					</Text>
				</Text>
			</Group>
		))}
	</Stack>
);

export const AdminLaunchProfit: React.FC<{ plan: DeployPlan }> = ({ plan }) => {
	const { network } = useCluster();
	const { publicKey } = useWallet();
	const dexProgram = DEX_PROGRAM_ID[network];
	const solvesConfig = PROGRAM_CONFIG[network];
	const { client, ctx } = useClient(dexProgram);

	const usdcMint = useMemo(
		() =>
			AddressUtil.toPubKey(
				network === ClusterNetwork.Devnet
					? DEVNET_USDC_MINT.toString()
					: USDC.address,
			),
		[network],
	);
	const solv3Mint = useMemo(
		() => AddressUtil.toPubKey(plan.pool.tokenMintA),
		[plan],
	);
	const solMint = useMemo(() => AddressUtil.toPubKey(SOL.address), []);

	const [scan, setScan] = useState<ScanState | null>(null);
	const [selected, setSelected] = useState<Record<string, boolean>>({});
	const [usdcToDeploy, setUsdcToDeploy] = useState(0);
	const [blueChipPct, setBlueChipPct] = useState(50);
	const [blueLow, setBlueLow] = useState(10);
	const [blueHigh, setBlueHigh] = useState(10);
	const [solvLow, setSolvLow] = useState(15);
	const [solvHigh, setSolvHigh] = useState(25);
	const [bluePools, setBluePools] = useState<PoolOption[]>([]);
	const [blueSpacing, setBlueSpacing] = useState<string | null>(null);
	const [previewChecks, setPreviewChecks] = useState<Check[] | null>(null);
	const [logLines, setLogLines] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);

	const log = useCallback(
		(line: string) => setLogLines((prev) => [...prev, line]),
		[],
	);

	const ladderPoolAddress = useMemo(
		() =>
			PDAUtil.getSolve(
				dexProgram,
				solvesConfig,
				solv3Mint,
				usdcMint,
				plan.pool.tickSpacing,
			).publicKey,
		[dexProgram, solvesConfig, solv3Mint, usdcMint, plan],
	);

	const tokenBalance = useCallback(
		async (mint: PublicKey): Promise<bigint> => {
			const owner = ctx.wallet?.publicKey;
			if (!owner) return BigInt(0);
			const accounts = await ctx.connection.getParsedTokenAccountsByOwner(
				owner,
				{ mint },
			);
			let total = accounts.value.reduce(
				(sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount),
				BigInt(0),
			);
			// Native SOL can be wrapped on the fly; count it, minus a reserve.
			if (mint.equals(solMint)) {
				const lamports = await ctx.connection.getBalance(owner);
				total += BigInt(Math.max(0, lamports - SOL_RESERVE_LAMPORTS));
			}
			return total;
		},
		[ctx, solMint],
	);

	const getPoolSafe = useCallback(
		async (address: PublicKey): Promise<Solve | null> => {
			try {
				return await client.getPool(address, IGNORE_CACHE);
			} catch {
				return null;
			}
		},
		[client],
	);

	const loadLadderPositions = useCallback(async () => {
		const owner = ctx.wallet?.publicKey;
		if (!owner) throw new Error("Connect the wallet that owns the ladder");
		const pool = await getPoolSafe(ladderPoolAddress);
		if (!pool) throw new Error("Ladder pool not found on this cluster");
		const data = pool.getData();
		const map = await getAllPositionAccountsByOwner({
			owner,
			ctx,
			includesPositions: true,
			includesPositionsWithTokenExtensions: true,
			includesBundledPositions: false,
		});
		const all = [
			...Array.from(map.positions.entries()),
			...Array.from(map.positionsWithTokenExtensions.entries()),
		].filter(([, p]) => p?.solve.equals(ladderPoolAddress));
		const positions: LadderPosition[] = all.map(([address, p]) => {
			const pos = p as NonNullable<typeof p>;
			const amounts = PoolUtil.getTokenAmountsFromLiquidity(
				pos.liquidity,
				data.sqrtPrice,
				PriceMath.tickIndexToSqrtPriceX64(pos.tickLowerIndex),
				PriceMath.tickIndexToSqrtPriceX64(pos.tickUpperIndex),
				false,
			);
			return {
				address: address.toString(),
				tickLower: pos.tickLowerIndex,
				tickUpper: pos.tickUpperIndex,
				status: classifyPosition(
					data.tickCurrentIndex,
					pos.tickLowerIndex,
					pos.tickUpperIndex,
				),
				solv3: BigInt(amounts.tokenA.toString()),
				usdc: BigInt(amounts.tokenB.toString()),
			};
		});
		positions.sort((a, b) => a.tickLower - b.tickLower);
		return { poolTick: data.tickCurrentIndex, positions };
	}, [ctx, getPoolSafe, ladderPoolAddress]);

	const refresh = useCallback(async () => {
		const { poolTick, positions } = await loadLadderPositions();
		const walletUsdc = await tokenBalance(usdcMint);
		setScan({ poolTick, positions, walletUsdc });
		setSelected((prev) => {
			const next: Record<string, boolean> = {};
			for (const p of positions) {
				next[p.address] = prev[p.address] ?? p.status === "filled";
			}
			return next;
		});
		// Find existing SOL/USDC pools across fee tiers, deepest first.
		const found: PoolOption[] = [];
		const [tokenA, tokenB] = PoolUtil.orderMints(solMint, usdcMint);
		for (const spacing of new Set(Object.values(TICK_SPACINGS))) {
			const address = PDAUtil.getSolve(
				dexProgram,
				solvesConfig,
				AddressUtil.toPubKey(tokenA),
				AddressUtil.toPubKey(tokenB),
				spacing,
			).publicKey;
			const pool = await getPoolSafe(address);
			if (pool) {
				found.push({
					tickSpacing: spacing,
					address,
					liquidity: pool.getData().liquidity.toString(),
				});
			}
		}
		found.sort((a, b) => Number(BigInt(b.liquidity) - BigInt(a.liquidity)));
		setBluePools(found);
		setBlueSpacing((cur) =>
			cur && found.some((f) => String(f.tickSpacing) === cur)
				? cur
				: found[0]
					? String(found[0].tickSpacing)
					: null,
		);
		return { positions, walletUsdc };
	}, [
		loadLadderPositions,
		tokenBalance,
		usdcMint,
		solMint,
		dexProgram,
		solvesConfig,
		getPoolSafe,
	]);

	const simulateAndSend = useCallback(
		async (label: string, tx: TransactionBuilder) => {
			log(`${label}: simulating before asking you to sign…`);
			const payload = await tx.build({ blockhashCommitment: "finalized" });
			const t = payload.transaction;
			const sim =
				t instanceof VersionedTransaction
					? await ctx.connection.simulateTransaction(t, {
							sigVerify: false,
							replaceRecentBlockhash: true,
							commitment: "confirmed",
						})
					: await ctx.connection.simulateTransaction(t);
			if (sim.value.err) {
				throw new Error(
					`${label} simulation failed: ${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).slice(-4).join(" | ")}`,
				);
			}
			log(`${label}: simulation passed — approve it in your wallet.`);
			const signature = await tx.buildAndExecute({
				blockhashCommitment: "finalized",
			});
			const latest = await ctx.connection.getLatestBlockhash();
			await ctx.connection.confirmTransaction(
				{ signature, ...latest },
				"confirmed",
			);
			log(`${label}: confirmed ${signature}`);
		},
		[ctx, log],
	);

	const guarded = useCallback(
		async (fn: () => Promise<void>) => {
			setBusy(true);
			try {
				await fn();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log(`STOPPED: ${message}`);
				notification.error({ title: "Take profit", message });
			} finally {
				setBusy(false);
			}
		},
		[log],
	);

	const chosen = (scan?.positions ?? []).filter((p) => selected[p.address]);
	const chosenUsdc = chosen.reduce((sum, p) => sum + p.usdc, BigInt(0));

	// Step 1: close fully filled positions and collect their USDC + fees.
	const withdraw = useCallback(async () => {
		const owner = ctx.wallet.publicKey;
		const { positions } = await loadLadderPositions();
		const targets = positions.filter((p) => selected[p.address]);
		if (!targets.length) throw new Error("Select at least one position");
		for (const p of targets) {
			if (p.status !== "filled" || p.solv3 !== BigInt(0)) {
				throw new Error(
					`Position ${p.tickLower}→${p.tickUpper} still holds SOLV3 or is in range — only fully filled positions can be closed.`,
				);
			}
		}
		const expected = targets.reduce((s, p) => s + p.usdc, BigInt(0));
		const ladderPool = await getPoolSafe(ladderPoolAddress);
		if (!ladderPool) throw new Error("Ladder pool not found");
		const before = await tokenBalance(usdcMint);
		for (const p of targets) {
			const txs = await ladderPool.closePosition(
				AddressUtil.toPubKey(p.address),
				Percentage.fromFraction(1, 100),
				owner,
				owner,
				owner,
			);
			for (const [i, tx] of txs.entries()) {
								await simulateAndSend(
					`Close ${p.tickLower}→${p.tickUpper} (${i + 1}/${txs.length})`,
					tx,
				);
			}
		}
		const after = await tokenBalance(usdcMint);
		const delta = after - before;
		const minimum = BigInt(Math.floor(Number(expected) * WITHDRAW_MIN_SHARE));
		if (delta < minimum) {
			throw new Error(
				`Wallet USDC rose by ${fmtUsdc(delta)} but the positions held ${fmtUsdc(expected)} — check before continuing.`,
			);
		}
		log(
			`Withdrawn: wallet USDC +${fmtUsdc(delta)} (positions held ${fmtUsdc(expected)}, plus any fees).`,
		);
		setUsdcToDeploy(Number(delta) / 10 ** USDC_DECIMALS);
		await refresh();
	}, [
		ctx,
		loadLadderPositions,
		getPoolSafe,
		ladderPoolAddress,
		selected,
		tokenBalance,
		usdcMint,
		simulateAndSend,
		log,
		refresh,
	]);

	// Steps 2/3: add a USDC amount to a pool as a new position.
	const addLiquidity = useCallback(
		async (target: "bluechip" | "solv3", dryRun: boolean) => {
			const total = BigInt(Math.round(usdcToDeploy * 10 ** USDC_DECIMALS));
			const split = splitUsdc(total, Math.round(blueChipPct * 100));
			const allot = target === "bluechip" ? split.blueChip : split.solv3;
			if (allot === BigInt(0)) throw new Error("Nothing allotted to this pool");

			let pool: Solve | null;
			let low: number;
			let high: number;
			let label: string;
			if (target === "bluechip") {
				const option = bluePools.find(
					(o) => String(o.tickSpacing) === blueSpacing,
				);
				if (!option) throw new Error("No SOL/USDC pool found on this cluster");
				pool = await getPoolSafe(option.address);
				[low, high, label] = [blueLow, blueHigh, "SOL/USDC"];
			} else {
				pool = await getPoolSafe(ladderPoolAddress);
				[low, high, label] = [solvLow, solvHigh, "SOLV3/USDC"];
			}
			if (!pool) throw new Error(`${label} pool not found`);
			const data = pool.getData();
			const { tickLower, tickUpper } = rangeAroundTick(
				data.tickCurrentIndex,
				low,
				high,
				data.tickSpacing,
			);
			const extension =
				await TokenExtensionUtil.buildTokenExtensionContextForPool(
					ctx.fetcher,
					data.tokenMintA,
					data.tokenMintB,
					IGNORE_CACHE,
				);
			const quote =
				increaseLiquidityQuoteByInputTokenWithParamsUsingPriceSlippage({
					inputTokenMint: usdcMint,
					inputTokenAmount: new BN(allot.toString()),
					tokenMintA: data.tokenMintA,
					tokenMintB: data.tokenMintB,
					tickCurrentIndex: data.tickCurrentIndex,
					sqrtPrice: data.sqrtPrice,
					tickLowerIndex: tickLower,
					tickUpperIndex: tickUpper,
					slippageTolerance: Percentage.fromFraction(1, 100),
					tokenExtensionCtx: extension,
				});
			const [walletA, walletB] = await Promise.all([
				tokenBalance(data.tokenMintA),
				tokenBalance(data.tokenMintB),
			]);
			const checks = checkAddLiquidity({
				label,
				tokenEstA: BigInt(quote.tokenEstA.toString()),
				tokenEstB: BigInt(quote.tokenEstB.toString()),
				tokenMaxA: BigInt(quote.tokenMaxA.toString()),
				tokenMaxB: BigInt(quote.tokenMaxB.toString()),
				walletA,
				walletB,
				usdcIsA: data.tokenMintA.equals(usdcMint),
				usdcAllotted: allot,
			});
			checks.push({
				label: `${label}: range ${tickLower}→${tickUpper}`,
				ok: !quote.liquidityAmount.isZero(),
				detail: `liquidity ${quote.liquidityAmount}, USDC est ${fmtUsdc(
					BigInt(
						(data.tokenMintA.equals(usdcMint)
							? quote.tokenEstA
							: quote.tokenEstB
						).toString(),
					),
				)}`,
			});
			setPreviewChecks(checks);
			if (dryRun) return;
			if (!allPassed(checks)) throw new Error("Pre-sign checks failed");

			const initTick = await pool.initTickArrayForTicks(
				[tickLower, tickUpper],
				ctx.wallet.publicKey,
				IGNORE_CACHE,
			);
			const { tx, positionMint } = await pool.openPositionWithMetadata(
				tickLower,
				tickUpper,
				quote,
			);
			if (initTick) tx.prependInstruction(initTick.compressIx(false));
						await simulateAndSend(`Add ${label} liquidity`, tx);

			// Read back the new position against the quote.
			const readbackPosition = await client.getPosition(
				AddressUtil.toPubKey(
					PDAUtil.getPosition(dexProgram, positionMint).publicKey,
				),
				IGNORE_CACHE,
			);
			const pd = readbackPosition.getData();
			const diff =
				Math.abs(Number(pd.liquidity.sub(quote.liquidityAmount).toString())) /
				Math.max(1, Number(quote.liquidityAmount.toString()));
			if (
				pd.tickLowerIndex !== tickLower ||
				pd.tickUpperIndex !== tickUpper ||
				diff > LIQUIDITY_REL_TOLERANCE
			) {
				throw new Error(
					`${label}: position on chain does not match the quote (ticks ${pd.tickLowerIndex}→${pd.tickUpperIndex}, liquidity ${pd.liquidity}).`,
				);
			}
			log(
				`${label}: position ${positionMint.toBase58()} verified against the quote.`,
			);
			await refresh();
		},
		[
			usdcToDeploy,
			blueChipPct,
			bluePools,
			blueSpacing,
			blueLow,
			blueHigh,
			solvLow,
			solvHigh,
			getPoolSafe,
			ladderPoolAddress,
			ctx,
			client,
			usdcMint,
			tokenBalance,
			dexProgram,
			simulateAndSend,
			log,
			refresh,
		],
	);

	const split = splitUsdc(
		BigInt(Math.round(usdcToDeploy * 10 ** USDC_DECIMALS)),
		Math.round(Math.min(100, Math.max(0, blueChipPct)) * 100),
	);

	return (
		<CardLayout>
			<Stack gap="sm">
				<Group justify="space-between" align="baseline">
					<Text fz="lg" fw="bold">
						Take profit
					</Text>
					<Badge color={network === ClusterNetwork.Mainnet ? "red" : "blue"}>
						{network}
					</Badge>
				</Group>
				<Text fz="xs" c="gray">
					Closes fully filled ladder bands (pure USDC) and collects their fees,
					then sends your chosen share to SOL/USDC and the rest back into
					SOLV3/USDC around the current price. Every transaction is simulated
					before signing. Bands still in range are never touched, so unsold
					SOLV3 stays for sale. Closing a filled band removes the USDC that was
					acting as buy support below the market.
				</Text>

				<Group>
					<Button
						size="xs"
						variant="default"
						disabled={busy || !publicKey}
						onClick={() => guarded(async () => void (await refresh()))}
					>
						Load ladder positions
					</Button>
				</Group>

				{scan ? (
					<Stack gap={4}>
						<Text fz="xs" c="gray">
							Pool tick {scan.poolTick} · wallet USDC {fmtUsdc(scan.walletUsdc)}
						</Text>
						{scan.positions.map((p) => (
							<Group key={p.address} gap="xs" wrap="nowrap">
								<input
									type="checkbox"
									disabled={p.status !== "filled"}
									checked={!!selected[p.address]}
									onChange={(e) =>
										setSelected((prev) => ({
											...prev,
											[p.address]: e.target.checked,
										}))
									}
								/>
								<Badge
									size="xs"
									variant="light"
									color={
										p.status === "filled"
											? "green"
											: p.status === "active"
												? "yellow"
												: "gray"
									}
								>
									{p.status}
								</Badge>
								<Text fz="xs">
									{p.tickLower}→{p.tickUpper} · USDC {fmtUsdc(p.usdc)} · SOLV3{" "}
									{(Number(p.solv3) / 1e9).toLocaleString(undefined, {
										maximumFractionDigits: 0,
									})}
								</Text>
							</Group>
						))}
						<Text fz="xs">
							Selected: {chosen.length} position(s), {fmtUsdc(chosenUsdc)} USDC
							before fees.
						</Text>
					</Stack>
				) : null}

				<Button
					size="xs"
					disabled={busy || chosen.length === 0}
					loading={busy}
					onClick={() => guarded(withdraw)}
				>
					1 · Withdraw selected bands
				</Button>

				<Group grow align="flex-end">
					<NumberInput
						size="xs"
						label="USDC to redeploy"
						value={usdcToDeploy}
						min={0}
						decimalScale={USDC_DECIMALS}
						onChange={(v) => setUsdcToDeploy(Number(v) || 0)}
					/>
					<NumberInput
						size="xs"
						label="% to SOL/USDC"
						value={blueChipPct}
						min={0}
						max={100}
						decimalScale={2}
						onChange={(v) => setBlueChipPct(Number(v) || 0)}
					/>
				</Group>
				<Text fz="xs" c="gray">
					SOL/USDC {fmtUsdc(split.blueChip)} · SOLV3/USDC {fmtUsdc(split.solv3)}
					. Defaults to what step 1 actually collected.
				</Text>

				<Select
					size="xs"
					label="SOL/USDC fee tier (deepest first)"
					data={bluePools.map((o) => ({
						value: String(o.tickSpacing),
						label: `tick spacing ${o.tickSpacing} · liquidity ${o.liquidity}`,
					}))}
					value={blueSpacing}
					onChange={setBlueSpacing}
					placeholder="Load positions to find pools"
				/>
				<Group grow>
					<NumberInput
						size="xs"
						label="SOL/USDC range −%"
						value={blueLow}
						min={0.1}
						max={99}
						onChange={(v) => setBlueLow(Number(v) || 0)}
					/>
					<NumberInput
						size="xs"
						label="SOL/USDC range +%"
						value={blueHigh}
						min={0.1}
						onChange={(v) => setBlueHigh(Number(v) || 0)}
					/>
					<NumberInput
						size="xs"
						label="SOLV3 range −%"
						value={solvLow}
						min={0.1}
						max={99}
						onChange={(v) => setSolvLow(Number(v) || 0)}
					/>
					<NumberInput
						size="xs"
						label="SOLV3 range +%"
						value={solvHigh}
						min={0.1}
						onChange={(v) => setSolvHigh(Number(v) || 0)}
					/>
				</Group>
				<Text fz="xs" c="gray">
					A range that straddles the price is two-sided and pulls the paired
					token (SOL or SOLV3) from your wallet; the preview shows how much. A
					range entirely below the price would be USDC only.
				</Text>

				<Group>
					{(["bluechip", "solv3"] as const).map((target) => (
						<Group key={target} gap="xs">
							<Button
								size="xs"
								variant="default"
								disabled={busy || usdcToDeploy <= 0}
								onClick={() => guarded(() => addLiquidity(target, true))}
							>
								Preview {target === "bluechip" ? "SOL/USDC" : "SOLV3/USDC"}
							</Button>
							<Button
								size="xs"
								disabled={busy || usdcToDeploy <= 0}
								onClick={() => guarded(() => addLiquidity(target, false))}
							>
								{target === "bluechip"
									? "2 · Add to SOL/USDC"
									: "3 · Add to SOLV3/USDC"}
							</Button>
						</Group>
					))}
				</Group>

				{previewChecks ? (
					<Checks title="Latest pre-sign checks" checks={previewChecks} />
				) : null}
				{logLines.length ? (
					<pre
						style={{
							fontSize: 11,
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							maxHeight: 220,
							overflow: "auto",
						}}
					>
						{logLines.join("\n")}
					</pre>
				) : null}
			</Stack>
		</CardLayout>
	);
};
