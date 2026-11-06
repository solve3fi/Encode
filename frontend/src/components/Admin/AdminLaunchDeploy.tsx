"use client";

import { Badge, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import type { TransactionBuilder } from "@solve3fi/common";
import { AddressUtil, Percentage } from "@solve3fi/common";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import {
	getAllPositionAccountsByOwner,
	IGNORE_CACHE,
	increaseLiquidityQuoteByInputTokenWithParams,
	PDAUtil,
	PoolUtil,
	PriceMath,
	TokenExtensionUtil,
} from "@solve3fi/sdk";
import BN from "bn.js";
import { useCallback, useMemo, useState } from "react";
import { notification } from "@/components/Notifications";
import { DEX_PROGRAM_ID, PROGRAM_CONFIG } from "@/configs/addresses";
import { DEVNET_USDC_MINT } from "@/configs/devnetFaucet";
import {
	allPassed,
	type ChainReadback,
	type Check,
	checkPlan,
	type DeployPlan,
	evaluateReadback,
	planFingerprintSource,
} from "@/lib/launchLadderDeploy";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { useClient } from "@/providers/DappProvider";
import { CardLayout } from "../Layout/CardLayout";

const LAUNCH_CONFIRM_WORD = "LAUNCH";
const REHEARSAL_KEY = "solve3.launchLadder.rehearsal.";

// Planned liquidity is float math; chain is integer Q64 math.
const LIQUIDITY_REL_TOLERANCE = 1e-6;
// Rent + fees headroom on top of the plan's estimate, in SOL.
const SOL_BUFFER = 0.15;

type ScanState = {
	checks: Check[];
	poolAddress: string | null;
	poolExists: boolean;
	bandDone: boolean[];
};

const relDiff = (a: bigint, b: bigint) => {
	if (a === b) return 0;
	const diff = a > b ? a - b : b - a;
	return (
		Number((diff * BigInt(1_000_000_000)) / (b === BigInt(0) ? BigInt(1) : b)) /
		1_000_000_000
	);
};

const sha256Hex = async (text: string) => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
};

const readRehearsal = (hash: string) => {
	try {
		return window.localStorage.getItem(REHEARSAL_KEY + hash);
	} catch {
		return null;
	}
};
const writeRehearsal = (hash: string) => {
	try {
		window.localStorage.setItem(REHEARSAL_KEY + hash, new Date().toISOString());
	} catch {
		// Only a convenience gate; the readback itself is what matters.
	}
};

const CheckList: React.FC<{ title: string; checks: Check[] }> = ({
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
					{c.detail ? (
						<Text span c="gray" fz="xs">
							{" "}
							— {c.detail}
						</Text>
					) : null}
				</Text>
			</Group>
		))}
	</Stack>
);

export const AdminLaunchDeploy: React.FC<{ plan: DeployPlan }> = ({ plan }) => {
	const { network } = useCluster();
	const { publicKey } = useWallet();
	const dexProgram = DEX_PROGRAM_ID[network];
	const solvesConfig = PROGRAM_CONFIG[network];
	const { client, ctx } = useClient(dexProgram);
	const isMainnet = network === ClusterNetwork.Mainnet;

	// The plan is written for mainnet mints. A devnet rehearsal swaps in the
	// devnet USDC the faucet hands out; SOLV3's mint is already a devnet mint.
	const effectivePlan = useMemo<DeployPlan>(
		() =>
			network === ClusterNetwork.Devnet
				? {
						...plan,
						pool: { ...plan.pool, tokenMintB: DEVNET_USDC_MINT.toString() },
					}
				: plan,
		[plan, network],
	);

	const planChecks = useMemo(() => checkPlan(effectivePlan), [effectivePlan]);
	const planOk = allPassed(planChecks);

	const [scan, setScan] = useState<ScanState | null>(null);
	const [readback, setReadback] = useState<Check[] | null>(null);
	const [logLines, setLogLines] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [confirmWord, setConfirmWord] = useState("");
	const [rehearsedAt, setRehearsedAt] = useState<string | null>(null);

	const log = useCallback(
		(line: string) => setLogLines((prev) => [...prev, line]),
		[],
	);

	const mintA = useMemo(
		() => AddressUtil.toPubKey(effectivePlan.pool.tokenMintA),
		[effectivePlan],
	);
	const mintB = useMemo(
		() => AddressUtil.toPubKey(effectivePlan.pool.tokenMintB),
		[effectivePlan],
	);

	const poolAddress = useMemo(
		() =>
			PDAUtil.getSolve(
				dexProgram,
				solvesConfig,
				mintA,
				mintB,
				effectivePlan.pool.tickSpacing,
			).publicKey,
		[dexProgram, solvesConfig, mintA, mintB, effectivePlan],
	);

	const loadRehearsal = useCallback(async () => {
		const hash = await sha256Hex(planFingerprintSource(effectivePlan));
		setRehearsedAt(readRehearsal(hash));
		return hash;
	}, [effectivePlan]);

	// Positions the connected wallet holds in this pool.
	const loadPositions = useCallback(async () => {
		if (!ctx.wallet?.publicKey) return [];
		const map = await getAllPositionAccountsByOwner({
			owner: ctx.wallet.publicKey,
			ctx,
			includesPositions: true,
			includesPositionsWithTokenExtensions: true,
			includesBundledPositions: false,
		});
		return [
			...Array.from(map.positions.entries()),
			...Array.from(map.positionsWithTokenExtensions.entries()),
		]
			.filter(([, data]) => data?.solve.equals(poolAddress))
			.map(([address, data]) => ({
				address,
				data: data as NonNullable<typeof data>,
			}));
	}, [ctx, poolAddress]);

	const runScan = useCallback(async (): Promise<ScanState> => {
		const checks: Check[] = [];
		const connection = ctx.connection;
		const wallet = ctx.wallet?.publicKey;

		checks.push({
			label: "Wallet connected",
			ok: !!wallet,
			detail: wallet?.toBase58() ?? "connect the deployer wallet",
		});

		const programInfo = await connection.getAccountInfo(dexProgram);
		checks.push({
			label: "Solve program is deployed on this cluster",
			ok: !!programInfo?.executable,
			detail: `${dexProgram.toBase58()} on ${network}`,
		});

		const configInfo = await connection.getAccountInfo(solvesConfig);
		checks.push({
			label: "SolvesConfig account exists and belongs to the program",
			ok: !!configInfo && configInfo.owner.equals(dexProgram),
			detail: solvesConfig.toBase58(),
		});

		const [mintAInfo, mintBInfo] = await Promise.all([
			connection.getAccountInfo(mintA),
			connection.getAccountInfo(mintB),
		]);
		checks.push({
			label: "SOLV3 and USDC mints exist on this cluster",
			ok: !!mintAInfo && !!mintBInfo,
			detail: `A ${mintA.toBase58()} · B ${mintB.toBase58()}`,
		});

		const [orderedA] = PoolUtil.orderMints(mintA, mintB);
		checks.push({
			label: "SOLV3 sorts as pool token A (price not inverted)",
			ok: AddressUtil.toPubKey(orderedA).equals(mintA),
			detail: "the plan's ticks assume SOLV3 is token A",
		});

		let poolExists = false;
		const bandDone = effectivePlan.positions.map(() => false);
		let existing: Awaited<ReturnType<typeof client.getPool>> | null = null;
		try {
			existing = await client.getPool(poolAddress, IGNORE_CACHE);
		} catch {
			existing = null;
		}
		if (existing) {
			poolExists = true;
			const data = existing.getData();
			const positions = await loadPositions();
			effectivePlan.positions.forEach((band, i) => {
				bandDone[i] = positions.some(
					(p) =>
						p.data.tickLowerIndex === band.tickLowerIndex &&
						p.data.tickUpperIndex === band.tickUpperIndex,
				);
			});
			checks.push({
				label: "Existing pool matches the plan's tick spacing",
				ok: data.tickSpacing === effectivePlan.pool.tickSpacing,
				detail: poolAddress.toBase58(),
			});
			// Pool addresses are deterministic, so anyone could have created this
			// pool early at a different price. A pool that wasn't initialized at
			// the planned tick cannot host the ladder.
			const untouched = bandDone.every((done) => !done);
			checks.push({
				label: "Existing pool starts at the planned launch tick",
				ok: untouched
					? data.tickCurrentIndex === effectivePlan.pool.initialTickIndex
					: data.tickCurrentIndex < effectivePlan.positions[0].tickLowerIndex ||
						bandDone.every(Boolean),
				detail: `pool tick ${data.tickCurrentIndex}, plan ${effectivePlan.pool.initialTickIndex}`,
			});
		}

		if (wallet) {
			const [solLamports, tokenAccounts] = await Promise.all([
				connection.getBalance(wallet),
				connection.getParsedTokenAccountsByOwner(wallet, { mint: mintA }),
			]);
			const held = tokenAccounts.value.reduce(
				(sum, acc) =>
					sum + BigInt(acc.account.data.parsed.info.tokenAmount.amount),
				BigInt(0),
			);
			// Bands already open have spent their SOLV3; only the rest is needed.
			const need = effectivePlan.positions.reduce(
				(sum, band, i) => (bandDone[i] ? sum : sum + BigInt(band.tokenAAmount)),
				BigInt(0),
			);
			checks.push({
				label: "Wallet holds the SOLV3 for every band still to open",
				ok: held >= need,
				detail: `${held} of ${need} base units`,
			});
			const needSol =
				effectivePlan.tickArrayStartIndices.length * 0.07 + SOL_BUFFER;
			checks.push({
				label: "Wallet has enough SOL for rent and fees",
				ok: solLamports / 1e9 >= needSol,
				detail: `${(solLamports / 1e9).toFixed(3)} SOL, want ≥ ${needSol.toFixed(2)}`,
			});
		}

		const state = {
			checks,
			poolAddress: poolAddress.toBase58(),
			poolExists,
			bandDone,
		};
		setScan(state);
		return state;
	}, [
		ctx,
		client,
		dexProgram,
		solvesConfig,
		mintA,
		mintB,
		network,
		effectivePlan,
		poolAddress,
		loadPositions,
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

	const createPool = useCallback(async () => {
		const { tx, poolKey } = await client.createPool(
			solvesConfig,
			mintA,
			mintB,
			effectivePlan.pool.tickSpacing,
			effectivePlan.pool.initialTickIndex,
			ctx.wallet.publicKey,
		);
		if (!poolKey.equals(poolAddress)) {
			throw new Error(
				`Pool address mismatch: SDK ${poolKey.toBase58()} vs expected ${poolAddress.toBase58()}`,
			);
		}
		await simulateAndSend("Create pool", tx);
	}, [
		client,
		ctx,
		solvesConfig,
		mintA,
		mintB,
		effectivePlan,
		poolAddress,
		simulateAndSend,
	]);

	const openBand = useCallback(
		async (index: number) => {
			const band = effectivePlan.positions[index];
			const pool = await client.getPool(poolAddress, IGNORE_CACHE);
			const data = pool.getData();
			if (data.tickCurrentIndex >= band.tickLowerIndex) {
				throw new Error(
					"Pool price has already reached this band — stop and re-plan; the band is no longer single-sided.",
				);
			}
			const extension =
				await TokenExtensionUtil.buildTokenExtensionContextForPool(
					ctx.fetcher,
					mintA,
					mintB,
					IGNORE_CACHE,
				);
			const planned = BigInt(band.tokenAAmount);
			const quote = increaseLiquidityQuoteByInputTokenWithParams({
				inputTokenMint: mintA,
				inputTokenAmount: new BN(band.tokenAAmount),
				tokenMintA: mintA,
				tokenMintB: mintB,
				tickCurrentIndex: data.tickCurrentIndex,
				sqrtPrice: data.sqrtPrice,
				tickLowerIndex: band.tickLowerIndex,
				tickUpperIndex: band.tickUpperIndex,
				slippageTolerance: Percentage.fromFraction(0, 100),
				tokenExtensionCtx: extension,
			});
			if (!quote.tokenEstB.isZero() || !quote.tokenMaxB.isZero()) {
				throw new Error(
					`${band.band}: quote would pull USDC (est ${quote.tokenEstB}, max ${quote.tokenMaxB}) — refusing.`,
				);
			}
			if (BigInt(quote.tokenMaxA.toString()) > planned) {
				throw new Error(
					`${band.band}: quote wants more SOLV3 (${quote.tokenMaxA}) than planned (${planned}) — refusing.`,
				);
			}
			const liqDiff = relDiff(
				BigInt(quote.liquidityAmount.toString()),
				BigInt(band.expectedLiquidity),
			);
			if (liqDiff > LIQUIDITY_REL_TOLERANCE) {
				throw new Error(
					`${band.band}: SDK liquidity ${quote.liquidityAmount} differs from plan ${band.expectedLiquidity} (${(liqDiff * 100).toFixed(4)}%) — refusing.`,
				);
			}
			const input = { ...quote, tokenMaxB: new BN(0) };

			const initTick = await pool.initTickArrayForTicks(
				[band.tickLowerIndex, band.tickUpperIndex],
				ctx.wallet.publicKey,
				IGNORE_CACHE,
			);
			const { tx } = await pool.openPositionWithMetadata(
				band.tickLowerIndex,
				band.tickUpperIndex,
				input,
			);
			if (initTick) tx.prependInstruction(initTick.compressIx(false));
						await simulateAndSend(`Open ${band.band} band`, tx);
		},
		[
			client,
			ctx,
			mintA,
			mintB,
			effectivePlan,
			poolAddress,
			simulateAndSend,
		],
	);

	const verify = useCallback(async () => {
		const pool = await client.getPool(poolAddress, IGNORE_CACHE);
		const data = pool.getData();
		const [vaultA, vaultB, positions] = await Promise.all([
			ctx.connection.getTokenAccountBalance(data.tokenVaultA, "confirmed"),
			ctx.connection.getTokenAccountBalance(data.tokenVaultB, "confirmed"),
			loadPositions(),
		]);
		const chain: ChainReadback = {
			mintA: data.tokenMintA.toBase58(),
			mintB: data.tokenMintB.toBase58(),
			tickSpacing: data.tickSpacing,
			tickCurrentIndex: data.tickCurrentIndex,
			sqrtPrice: BigInt(data.sqrtPrice.toString()),
			expectedSqrtPrice: BigInt(
				PriceMath.tickIndexToSqrtPriceX64(
					effectivePlan.pool.initialTickIndex,
				).toString(),
			),
			poolLiquidity: BigInt(data.liquidity.toString()),
			vaultA: BigInt(vaultA.value.amount),
			vaultB: BigInt(vaultB.value.amount),
			positions: positions.map((p) => ({
				mint: p.data.positionMint.toBase58(),
				tickLower: p.data.tickLowerIndex,
				tickUpper: p.data.tickUpperIndex,
				liquidity: BigInt(p.data.liquidity.toString()),
			})),
		};
		const checks = evaluateReadback(effectivePlan, chain);
		setReadback(checks);
		if (allPassed(checks) && !isMainnet) {
			writeRehearsal(await sha256Hex(planFingerprintSource(effectivePlan)));
			await loadRehearsal();
		}
		return checks;
	}, [
		client,
		ctx,
		poolAddress,
		effectivePlan,
		loadPositions,
		isMainnet,
		loadRehearsal,
	]);

	const guarded = useCallback(
		async (fn: () => Promise<void>) => {
			setBusy(true);
			try {
				await fn();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log(`STOPPED: ${message}`);
				notification.error({ title: "Launch deploy", message });
			} finally {
				setBusy(false);
			}
		},
		[log],
	);

	const mainnetUnlocked =
		!isMainnet || (confirmWord === LAUNCH_CONFIRM_WORD && !!rehearsedAt);
	const preflightOk =
		!!scan &&
		allPassed(scan.checks.filter((c) => !c.label.startsWith("Existing pool")));
	const canAct = planOk && preflightOk && mainnetUnlocked && !busy;

	const runAll = () =>
		guarded(async () => {
			let state = await runScan();
			if (!allPassed(state.checks)) {
				throw new Error("Preflight failed — fix the red items first.");
			}
			if (!state.poolExists) {
				await createPool();
				state = await runScan();
			}
			for (let i = 0; i < effectivePlan.positions.length; i++) {
				if (state.bandDone[i]) continue;
				await openBand(i);
				state = await runScan();
			}
			const checks = await verify();
			log(
				allPassed(checks)
					? "ALL CHECKS PASSED — safe to announce."
					: "READBACK HAS FAILURES — do not announce.",
			);
		});

	const rehearsalLabel = rehearsedAt
		? `Rehearsed on devnet ${new Date(rehearsedAt).toLocaleString()}`
		: "Not rehearsed on devnet yet";

	return (
		<CardLayout>
			<Stack gap="sm">
				<Group justify="space-between" align="baseline">
					<Text fz="lg" fw="bold">
						Deploy from this page
					</Text>
					<Group gap="xs">
						<Badge color={isMainnet ? "red" : "blue"}>{network}</Badge>
						<Badge color={rehearsedAt ? "green" : "gray"} variant="light">
							{rehearsalLabel}
						</Badge>
					</Group>
				</Group>
				<Text fz="xs" c="gray">
					Creates the pool and opens the three single-sided SOLV3 positions
					straight from the saved plan. Every transaction is simulated before
					your wallet is asked to sign, USDC is capped at 0, and the result is
					read back from chain against the plan.{" "}
					{isMainnet
						? "Mainnet needs a passing devnet rehearsal of this exact plan."
						: "Rehearse here first — a pass is remembered in this browser."}{" "}
					{network === ClusterNetwork.Devnet
						? "Devnet uses the faucet's devUSDC in place of USDC."
						: ""}
				</Text>

				<CheckList title="Plan checks" checks={planChecks} />

				<Group>
					<Button
						size="xs"
						variant="default"
						disabled={busy || !publicKey}
						onClick={() =>
							guarded(async () => {
								await loadRehearsal();
								await runScan();
							})
						}
					>
						Check chain status
					</Button>
				</Group>
				{scan ? (
					<CheckList title="Preflight (live from chain)" checks={scan.checks} />
				) : null}
				{scan ? (
					<Text fz="xs" c="gray">
						Pool {scan.poolAddress} —{" "}
						{scan.poolExists ? "exists" : "not created yet"} · bands open:{" "}
						{scan.bandDone.filter(Boolean).length}/{scan.bandDone.length}
					</Text>
				) : null}

				{isMainnet ? (
					<TextInput
						size="xs"
						label={`Type ${LAUNCH_CONFIRM_WORD} to unlock the mainnet buttons`}
						value={confirmWord}
						onChange={(e) => setConfirmWord(e.currentTarget.value)}
						error={
							confirmWord && confirmWord !== LAUNCH_CONFIRM_WORD
								? "Must match exactly"
								: !rehearsedAt
									? "Blocked until this plan passes a devnet rehearsal"
									: undefined
						}
					/>
				) : null}

				<Group>
					<Button size="xs" disabled={!canAct} loading={busy} onClick={runAll}>
						Run every remaining step
					</Button>
					<Button
						size="xs"
						variant="default"
						disabled={busy || !scan?.poolExists}
						onClick={() => guarded(async () => void (await verify()))}
					>
						Verify on chain
					</Button>
				</Group>
				<Text fz="xs" c="gray">
					Each step asks your wallet to sign once. If anything stops, nothing is
					lost: press the button again and it resumes from what is already on
					chain.
				</Text>

				{readback ? (
					<CheckList title="Readback vs plan" checks={readback} />
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

export const parseDeployPlan = (json: string): DeployPlan | null => {
	try {
		return JSON.parse(json) as DeployPlan;
	} catch {
		return null;
	}
};
