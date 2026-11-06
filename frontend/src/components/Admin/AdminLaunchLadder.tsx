"use client";

import { useLingui } from "@lingui/react";
import {
	Badge,
	Box,
	Button,
	Grid,
	Group,
	NumberInput,
	Select,
	SimpleGrid,
	Stack,
	Table,
	Text,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { notification } from "@/components/Notifications";
import {
	DEFAULT_LAUNCH_LADDER,
	LAUNCH_FEE_TIERS,
	LAUNCH_LADDER_PRESETS,
	LAUNCH_LADDER_READ_ACTION,
	LAUNCH_LADDER_SAVE_ACTION,
	LAUNCH_TOKEN_A_MINT,
	LAUNCH_TOKEN_B_MINT,
	LAUNCH_TOTAL_SUPPLY,
	type LaunchLadderInputs,
	type LaunchTickSpacing,
	type SavedLaunchLadder,
	validateLaunchLadderInputs,
} from "@/configs/launchLadder";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { formatAddress, formatTokenAmount } from "@/lib/format";
import {
	computeLadder,
	type LadderBand,
	type LadderModel,
	ladderDeployJson,
	walkLadder,
} from "@/lib/launchLadder";
import { CardLayout } from "../Layout/CardLayout";
import { AdminLaunchDeploy } from "./AdminLaunchDeploy";
import classes from "./AdminLaunchLadder.module.css";
import { AdminLaunchProfit } from "./AdminLaunchProfit";

// Ordinal ramp — thin → heavy reads light → dark in the site's purple.
const BAND_COLORS = {
	thin: "var(--mantine-color-purple-2)",
	medium: "var(--mantine-color-purple-5)",
	heavy: "var(--mantine-color-purple-6)",
} as const;
const FLOOR_COLOR = "var(--mantine-color-gray-12)";

const fmtUsd = (value: number) => {
	const abs = Math.abs(value);
	if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
	if (abs >= 1e3) return `$${(value / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}k`;
	return `$${value.toFixed(0)}`;
};
const fmtPrice = (value: number, digits = 4) => `$${value.toFixed(digits)}`;
const fmtLiquidity = (value: number) =>
	value.toExponential(2).replace("e+", "e");
const fmtTokens = (value: number) =>
	formatTokenAmount(value, { compact: true });

const SCENARIO_INFLOWS = [50_000, 100_000, 250_000, 500_000, 1_000_000];

type TipState = { x: number; y: number; lines: string[] } | null;

const ChartTip: React.FC<{ tip: TipState }> = ({ tip }) =>
	tip ? (
		<div className={classes.tip} style={{ left: tip.x, top: tip.y }}>
			{tip.lines.map((line, i) => (
				<div key={line} style={{ fontWeight: i === 0 ? 600 : 400 }}>
					{line}
				</div>
			))}
		</div>
	) : null;

// Position a tooltip next to the cursor inside the chart wrapper, flipping
// to the left when it would run off the right edge.
const tipPosition = (
	wrapper: HTMLElement | null,
	event: React.MouseEvent,
): { x: number; y: number } => {
	if (!wrapper) return { x: 0, y: 0 };
	const rect = wrapper.getBoundingClientRect();
	const x = event.clientX - rect.left;
	return {
		x: x > rect.width * 0.6 ? x - 190 : x + 14,
		y: event.clientY - rect.top - 10,
	};
};

const niceTicks = (min: number, max: number, count: number): number[] => {
	const raw = (max - min) / count;
	if (!(raw > 0)) return [min];
	const magnitude = 10 ** Math.floor(Math.log10(raw));
	const normalized = raw / magnitude;
	const step =
		(normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) *
		magnitude;
	const ticks: number[] = [];
	for (let v = Math.ceil(min / step) * step; v <= max + 1e-12; v += step) {
		ticks.push(Number(v.toFixed(10)));
	}
	return ticks;
};

const W = 720;
const H = 250;

const LiquidityProfileChart: React.FC<{ model: LadderModel }> = ({ model }) => {
	const wrapRef = useRef<HTMLDivElement>(null);
	const [tip, setTip] = useState<TipState>(null);
	const ml = 58;
	const mr = 16;
	const mt = 22;
	const mb = 34;
	const xMin =
		(model.floor ? model.floor.priceLower : model.inputs.launchPrice) * 0.94;
	const xMax = model.topPrice * 1.03;
	const maxL = Math.max(
		...model.bands.map((band) => band.liquidity),
		model.floor?.liquidity ?? 0,
	);
	const sx = (price: number) =>
		ml + ((price - xMin) / (xMax - xMin)) * (W - ml - mr);
	const sy = (liquidity: number) =>
		mt + (1 - liquidity / (maxL * 1.12)) * (H - mt - mb);

	const bar = (
		key: string,
		priceLower: number,
		priceUpper: number,
		liquidity: number,
		color: string,
		label: string,
		lines: string[],
	) => {
		const x0 = sx(priceLower) + 1;
		const x1 = sx(priceUpper) - 1;
		const y0 = sy(liquidity);
		const y1 = sy(0);
		const r = Math.max(0, Math.min(4, (x1 - x0) / 2));
		const d = `M${x0},${y1} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x1 - r} Q${x1},${y0} ${x1},${y0 + r} V${y1} Z`;
		return (
			<g key={key}>
				{/** biome-ignore lint/a11y/noStaticElementInteractions: hover tooltip on an SVG mark; values are also in the table */}
				<path
					d={d}
					fill={color}
					className={classes.bar}
					onMouseMove={(event) =>
						setTip({ ...tipPosition(wrapRef.current, event), lines })
					}
					onMouseLeave={() => setTip(null)}
				/>
				{x1 - x0 > 30 ? (
					<text
						x={(x0 + x1) / 2}
						y={y0 - 6}
						textAnchor="middle"
						className={classes.labelStrong}
					>
						{label}
					</text>
				) : null}
			</g>
		);
	};

	const launchX = sx(model.inputs.launchPrice);
	return (
		<div ref={wrapRef} className={classes.chartWrap}>
			<svg
				className={classes.chart}
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label="Liquidity per price range"
			>
				{niceTicks(0, maxL * 1.12, 4).map((v) => (
					<g key={v}>
						<line
							x1={ml}
							x2={W - mr}
							y1={sy(v)}
							y2={sy(v)}
							className={classes.grid}
						/>
						<text x={ml - 8} y={sy(v) + 4} textAnchor="end">
							{v === 0 ? "0" : fmtLiquidity(v)}
						</text>
					</g>
				))}
				<line
					x1={ml}
					x2={W - mr}
					y1={sy(0)}
					y2={sy(0)}
					className={classes.axis}
				/>
				{niceTicks(xMin, xMax, 6)
					.filter((p) => p >= xMin && p <= xMax)
					.map((p) => (
						<text key={p} x={sx(p)} y={H - 12} textAnchor="middle">
							{fmtPrice(p, 2)}
						</text>
					))}
				<text x={ml - 8} y={12} textAnchor="end" className={classes.label}>
					L
				</text>
				{model.floor
					? bar(
							"floor",
							model.floor.priceLower,
							model.floor.priceUpper,
							model.floor.liquidity,
							FLOOR_COLOR,
							"Floor",
							[
								"Floor (USDC bids)",
								`${fmtPrice(model.floor.priceLower, 3)} – ${fmtPrice(model.floor.priceUpper, 3)}`,
								`${fmtUsd(model.floor.usdc)} USDC · absorbs ${fmtTokens(model.floor.absorbsTokens)} SOLV3`,
							],
						)
					: null}
				{model.bands.map((band) =>
					bar(
						band.key,
						band.priceLower,
						band.priceUpper,
						band.liquidity,
						BAND_COLORS[band.key],
						band.key[0].toUpperCase() + band.key.slice(1),
						[
							`${band.key[0].toUpperCase() + band.key.slice(1)} ${fmtPrice(band.priceLower, 3)} – ${fmtPrice(band.priceUpper, 3)}`,
							`${fmtTokens(band.tokens)} SOLV3 · L ${fmtLiquidity(band.liquidity)}`,
							`${fmtUsd(band.usdcPerOnePercent)} per +1% · sells for ${fmtUsd(band.proceedsUsdc)}`,
						],
					),
				)}
				<line
					x1={launchX}
					x2={launchX}
					y1={mt - 6}
					y2={sy(0)}
					className={classes.launchLine}
				/>
				<text x={launchX + 5} y={mt + 4} className={classes.label}>
					launch {fmtPrice(model.inputs.launchPrice, 3)}
				</text>
			</svg>
			<ChartTip tip={tip} />
		</div>
	);
};

const BuyCurveChart: React.FC<{ model: LadderModel }> = ({ model }) => {
	const wrapRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const [tip, setTip] = useState<TipState>(null);
	const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
	const ml = 58;
	const mr = 20;
	const mt = 18;
	const mb = 34;
	const xMax = model.totalProceedsUsdc * 1.02;
	const yMin = model.inputs.launchPrice * 0.92;
	const yMax = model.topPrice * 1.05;
	const sx = (usdc: number) => ml + (usdc / xMax) * (W - ml - mr);
	const sy = (price: number) =>
		mt + (1 - (price - yMin) / (yMax - yMin)) * (H - mt - mb);

	let cumulative = 0;
	const segments = model.bands.map((band) => {
		const points: string[] = [];
		const steps = 40;
		for (let i = 0; i <= steps; i++) {
			const usdc = cumulative + (band.proceedsUsdc * i) / steps;
			points.push(
				`${sx(usdc).toFixed(1)},${sy(walkLadder(model, usdc).price).toFixed(1)}`,
			);
		}
		cumulative += band.proceedsUsdc;
		return {
			key: band.key,
			d: `M${points.join("L")}`,
			markerX: sx(cumulative),
			markerY: sy(band.priceUpper),
			label: `${fmtPrice(band.priceUpper, 3)} · ${fmtUsd(cumulative)}`,
		};
	});

	const onMove = (event: React.MouseEvent<SVGRectElement>) => {
		const svg = svgRef.current;
		if (!svg) return;
		const point = svg.createSVGPoint();
		point.x = event.clientX;
		point.y = event.clientY;
		const ctm = svg.getScreenCTM();
		if (!ctm) return;
		const local = point.matrixTransform(ctm.inverse());
		const usdc = Math.max(
			0,
			Math.min(
				model.totalProceedsUsdc,
				((local.x - ml) / (W - ml - mr)) * xMax,
			),
		);
		const state = walkLadder(model, usdc);
		setHover({ x: sx(usdc), y: sy(state.price) });
		setTip({
			...tipPosition(wrapRef.current, event),
			lines: [
				`${fmtUsd(usdc)} bought → ${fmtPrice(state.price)}`,
				`${fmtTokens(state.tokensSold)} SOLV3 sold · ${((state.tokensSold / model.inputs.floatTokens) * 100).toFixed(1)}% of float`,
				`${model.bands[state.bandIndex].key} band · FDV ${fmtUsd(state.price * LAUNCH_TOTAL_SUPPLY)}`,
			],
		});
	};

	return (
		<div ref={wrapRef} className={classes.chartWrap}>
			<svg
				ref={svgRef}
				className={classes.chart}
				viewBox={`0 0 ${W} ${H}`}
				role="img"
				aria-label="Price as a function of cumulative USDC bought"
			>
				{niceTicks(yMin, yMax, 4)
					.filter((p) => p >= yMin && p <= yMax)
					.map((p) => (
						<g key={p}>
							<line
								x1={ml}
								x2={W - mr}
								y1={sy(p)}
								y2={sy(p)}
								className={classes.grid}
							/>
							<text x={ml - 8} y={sy(p) + 4} textAnchor="end">
								{fmtPrice(p, 2)}
							</text>
						</g>
					))}
				<line
					x1={ml}
					x2={W - mr}
					y1={sy(yMin)}
					y2={sy(yMin)}
					className={classes.axis}
				/>
				{niceTicks(0, xMax, 6)
					.filter((v) => v <= xMax)
					.map((v) => (
						<text key={v} x={sx(v)} y={H - 12} textAnchor="middle">
							{fmtUsd(v)}
						</text>
					))}
				{segments.map((segment) => (
					<path
						key={segment.key}
						d={segment.d}
						className={classes.curve}
						stroke={BAND_COLORS[segment.key]}
					/>
				))}
				{segments.map((segment, i) => {
					const last = i === segments.length - 1;
					return (
						<g key={`${segment.key}-marker`}>
							<circle
								cx={segment.markerX}
								cy={segment.markerY}
								r={4.5}
								fill={BAND_COLORS[segment.key]}
								className={classes.marker}
							/>
							<text
								x={segment.markerX + (last ? -8 : 8)}
								y={segment.markerY + 15}
								textAnchor={last ? "end" : "start"}
								className={classes.label}
							>
								{segment.label}
							</text>
						</g>
					);
				})}
				{hover ? (
					<g>
						<line
							x1={hover.x}
							x2={hover.x}
							y1={mt}
							y2={sy(yMin)}
							className={classes.cross}
						/>
						<line
							x1={ml}
							x2={W - mr}
							y1={hover.y}
							y2={hover.y}
							className={classes.cross}
						/>
						<circle
							cx={hover.x}
							cy={hover.y}
							r={5}
							fill="var(--mantine-color-gray-1)"
							className={classes.marker}
						/>
					</g>
				) : null}
				{/** biome-ignore lint/a11y/noStaticElementInteractions: crosshair hover layer; values are also in the scenarios table */}
				<rect
					x={ml}
					y={mt}
					width={W - ml - mr}
					height={H - mt - mb}
					className={classes.hit}
					onMouseMove={onMove}
					onMouseLeave={() => {
						setHover(null);
						setTip(null);
					}}
				/>
			</svg>
			<ChartTip tip={tip} />
		</div>
	);
};

const bandName = (band: LadderBand) =>
	band.key[0].toUpperCase() + band.key.slice(1);

export const AdminLaunchLadder: React.FC = () => {
	const { i18n } = useLingui();
	const { sign } = useAdminAuth();
	const queryClient = useQueryClient();
	const [inputs, setInputs] = useState<LaunchLadderInputs>(
		DEFAULT_LAUNCH_LADDER,
	);
	const hydratedFromServer = useRef(false);

	// Reading the saved plan needs a wallet signature (the store has no
	// public GET), so ask once per page session rather than on every
	// refocus — the admin can re-sign with "Reload saved" if they need
	// another admin's newer save.
	const savedQuery = useQuery({
		queryKey: ["admin-launch-ladder"],
		queryFn: async () => {
			const { wallet, message, signature } = await sign(
				LAUNCH_LADDER_READ_ACTION,
			);
			const res = await fetch("/api/admin/launch-ladder/read", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, message, signature }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Failed to load");
			return data as SavedLaunchLadder | null;
		},
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
	});

	// Adopt the saved plan once on first load; later edits stay local until
	// the admin saves them, so a reload never silently discards work.
	useEffect(() => {
		if (hydratedFromServer.current || savedQuery.data === undefined) return;
		hydratedFromServer.current = true;
		if (savedQuery.data) {
			const validated = validateLaunchLadderInputs(savedQuery.data.inputs);
			if ("inputs" in validated) setInputs(validated.inputs);
		}
	}, [savedQuery.data]);

	const saveMutation = useMutation({
		mutationFn: async (next: LaunchLadderInputs) => {
			const { wallet, message, signature } = await sign(
				LAUNCH_LADDER_SAVE_ACTION,
				{ inputs: next },
			);
			const res = await fetch("/api/admin/launch-ladder", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, message, signature, inputs: next }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Save failed");
			return data as SavedLaunchLadder;
		},
		onSuccess: (data) => {
			queryClient.setQueryData(["admin-launch-ladder"], data);
			notification.success({
				title: i18n._("Launch ladder"),
				message: i18n._("Plan saved"),
			});
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Launch ladder"),
				message: error.message,
			});
		},
	});

	const validation = useMemo(
		() => validateLaunchLadderInputs(inputs),
		[inputs],
	);
	const model = useMemo(
		() => ("inputs" in validation ? computeLadder(validation.inputs) : null),
		[validation],
	);
	const deployJson = useMemo(
		() => (model ? JSON.stringify(ladderDeployJson(model), null, 2) : ""),
		[model],
	);
	const percentTotal =
		inputs.thinPercent + inputs.mediumPercent + inputs.heavyPercent;
	const isDirty =
		JSON.stringify(inputs) !==
		JSON.stringify(savedQuery.data?.inputs ?? DEFAULT_LAUNCH_LADDER);

	const setField =
		<K extends keyof LaunchLadderInputs>(key: K) =>
		(value: number | string) =>
			setInputs((prev) => ({
				...prev,
				[key]: typeof value === "number" ? value : Number(value) || 0,
			}));

	const priceField = (
		key: keyof LaunchLadderInputs,
		label: string,
		color?: string,
	) => (
		<NumberInput
			label={label}
			prefix="$"
			min={0}
			step={0.01}
			decimalScale={4}
			hideControls
			value={inputs[key]}
			onChange={setField(key)}
			styles={
				color ? { input: { borderLeft: `4px solid ${color}` } } : undefined
			}
		/>
	);
	const percentField = (
		key: keyof LaunchLadderInputs,
		label: string,
		color: string,
	) => (
		<NumberInput
			label={label}
			suffix="%"
			min={0}
			max={100}
			step={1}
			decimalScale={1}
			hideControls
			value={inputs[key]}
			onChange={setField(key)}
			styles={{ input: { borderLeft: `4px solid ${color}` } }}
		/>
	);

	const copyJson = async () => {
		try {
			await navigator.clipboard.writeText(deployJson);
			notification.success({
				title: i18n._("Launch ladder"),
				message: i18n._("Deploy JSON copied"),
			});
		} catch {
			notification.error({
				title: i18n._("Launch ladder"),
				message: i18n._("Clipboard blocked — select the JSON and copy it"),
			});
		}
	};

	const thin = model?.bands[0];
	const heavy = model?.bands[2];
	const depthRatio =
		model && thin && thin.liquidity > 0
			? `1 : ${(model.bands[1].liquidity / thin.liquidity).toFixed(1)} : ${(model.bands[2].liquidity / thin.liquidity).toFixed(1)}`
			: "—";

	return (
		<Stack gap="lg">
			<CardLayout>
				<Stack gap="md">
					<Group justify="space-between" align="flex-start" wrap="wrap">
						<Stack gap={4}>
							<Text fz="lg" fw="bold">
								{i18n._("Launch Ladder · SOLV3/USDC")}
							</Text>
							<Text fz="sm" c="gray" maw={760}>
								{i18n._(
									"Deploys the Initial Liquidity allocation as three single-sided SOLV3 ranges stacked above the launch price — a premium over the $0.12 presale, since presale tokens are locked and these are liquid: a thin band so the first buyers move price quickly, a medium band that starts absorbing demand, and a heavy band where most of the float is actually sold. Every other allocation is veSOLV3, so on day one this ladder is the circulating supply — a price-discovery sale that happens to be a pool.",
								)}
							</Text>
						</Stack>
						<Group gap="xs">
							{savedQuery.data ? (
								<Text fz="xs" c="gray">
									{i18n._("Saved by")}{" "}
									{formatAddress(savedQuery.data.updatedBy)}{" "}
									{new Date(savedQuery.data.updatedAt).toLocaleString()}
								</Text>
							) : savedQuery.isSuccess ? (
								<Text fz="xs" c="gray">
									{i18n._("Showing the published defaults — nothing saved yet")}
								</Text>
							) : savedQuery.isError ? (
								<Group gap={6}>
									<Text fz="xs" c="yellow">
										{i18n._(
											"Sign with the admin wallet to load the saved plan",
										)}
										{" — "}
										{savedQuery.error.message}
									</Text>
									<Button
										size="compact-xs"
										variant="default"
										onClick={() => savedQuery.refetch()}
									>
										{i18n._("Retry")}
									</Button>
								</Group>
							) : savedQuery.isPending ? (
								<Text fz="xs" c="gray">
									{i18n._("Loading saved plan…")}
								</Text>
							) : null}
							{isDirty ? (
								<Badge color="yellow" variant="light">
									{i18n._("Unsaved changes")}
								</Badge>
							) : null}
							<Button
								size="xs"
								loading={saveMutation.isPending}
								disabled={!model || percentTotal !== 100 || !isDirty}
								onClick={() => {
									if ("inputs" in validation)
										saveMutation.mutate(validation.inputs);
								}}
							>
								{i18n._("Save plan")}
							</Button>
						</Group>
					</Group>

					{model ? (
						<SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
							{[
								[
									i18n._("Float deployed"),
									`${formatTokenAmount(model.deployedTokens, { decimals: 0 })} SOLV3`,
									`${((model.deployedTokens / LAUNCH_TOTAL_SUPPLY) * 100).toFixed(1)}% ${i18n._("of supply · the only liquid allocation")}`,
								],
								[
									i18n._("Raise at full fill"),
									fmtUsd(model.totalProceedsUsdc),
									`${i18n._("avg")} ${fmtPrice(model.totalProceedsUsdc / Math.max(1, model.deployedTokens))} · ${(model.totalProceedsUsdc / Math.max(1, model.deployedTokens) / inputs.launchPrice).toFixed(2)}× ${i18n._("launch")}`,
								],
								[
									i18n._("Top of ladder"),
									fmtPrice(model.topPrice, 3),
									`FDV ${fmtUsd(model.topPrice * LAUNCH_TOTAL_SUPPLY)} · ${(model.topPrice / inputs.launchPrice).toFixed(1)}× ${i18n._("launch")}`,
								],
								[
									i18n._("Depth ratio"),
									depthRatio,
									`${i18n._("thin : medium : heavy by L")} · ${thin ? fmtUsd(thin.usdcPerOnePercent) : "—"} → ${heavy ? fmtUsd(heavy.usdcPerOnePercent) : "—"} ${i18n._("per +1%")}`,
								],
							].map(([label, value, detail]) => (
								<Box key={label} className={classes.stat}>
									<Text
										fz="xs"
										c="gray"
										tt="uppercase"
										style={{ letterSpacing: "0.06em" }}
									>
										{label}
									</Text>
									<Text fz="xl" fw={700} lh={1.15} mt={4}>
										{value}
									</Text>
									<Text fz="xs" c="gray" mt={4}>
										{detail}
									</Text>
								</Box>
							))}
						</SimpleGrid>
					) : null}

					<Grid gutter="md">
						<Grid.Col span={{ base: 12, md: 4 }}>
							<Stack gap="sm">
								<Text
									fz="xs"
									c="gray"
									tt="uppercase"
									style={{ letterSpacing: "0.06em" }}
								>
									{i18n._("Prices · USDC per SOLV3")}
								</Text>
								{priceField("launchPrice", i18n._("Launch (pool init)"))}
								{priceField(
									"thinTop",
									i18n._("Thin band top"),
									BAND_COLORS.thin,
								)}
								{priceField(
									"mediumTop",
									i18n._("Medium band top"),
									BAND_COLORS.medium,
								)}
								{priceField(
									"heavyTop",
									i18n._("Heavy band top"),
									BAND_COLORS.heavy,
								)}

								<Text
									fz="xs"
									c="gray"
									tt="uppercase"
									mt="xs"
									style={{ letterSpacing: "0.06em" }}
								>
									{i18n._("Allocation · % of float")}
								</Text>
								<SimpleGrid cols={3} spacing="xs">
									{percentField(
										"thinPercent",
										i18n._("Thin"),
										BAND_COLORS.thin,
									)}
									{percentField(
										"mediumPercent",
										i18n._("Medium"),
										BAND_COLORS.medium,
									)}
									{percentField(
										"heavyPercent",
										i18n._("Heavy"),
										BAND_COLORS.heavy,
									)}
								</SimpleGrid>
								{percentTotal !== 100 ? (
									<Text fz="xs" c="yellow">
										{i18n._(
											"Allocations total {total}% — they should total 100%.",
											{
												total: percentTotal,
											},
										)}
									</Text>
								) : null}
								<NumberInput
									label={i18n._("Float deployed (SOLV3)")}
									min={1}
									step={100_000}
									thousandSeparator=","
									decimalScale={0}
									hideControls
									value={inputs.floatTokens}
									onChange={setField("floatTokens")}
								/>
								<Select
									label={i18n._("Fee tier · tick spacing")}
									allowDeselect={false}
									value={String(inputs.tickSpacing)}
									onChange={(value) =>
										setInputs((prev) => ({
											...prev,
											tickSpacing: Number(value) as LaunchTickSpacing,
										}))
									}
									data={LAUNCH_FEE_TIERS.map((tier) => ({
										value: String(tier.tickSpacing),
										label: `${tier.label} · ${tier.tickSpacing}`,
									}))}
								/>

								<Text
									fz="xs"
									c="gray"
									tt="uppercase"
									mt="xs"
									style={{ letterSpacing: "0.06em" }}
								>
									{i18n._("Optional floor · USDC bids below launch")}
								</Text>
								<SimpleGrid cols={2} spacing="xs">
									<NumberInput
										label={i18n._("USDC placed")}
										prefix="$"
										min={0}
										step={10_000}
										thousandSeparator=","
										decimalScale={0}
										hideControls
										value={inputs.floorUsdc}
										onChange={setField("floorUsdc")}
										styles={{
											input: { borderLeft: `4px solid ${FLOOR_COLOR}` },
										}}
									/>
									{priceField(
										"floorBottomPrice",
										i18n._("Floor bottom"),
										FLOOR_COLOR,
									)}
								</SimpleGrid>

								<Group gap="xs" mt="xs">
									{(
										[
											["plan", i18n._("Plan default")],
											["steeper", i18n._("Steeper 5 / 25 / 70")],
											["flatter", i18n._("Flatter 20 / 35 / 45")],
										] as const
									).map(([key, label]) => (
										<Button
											key={key}
											size="xs"
											variant="default"
											onClick={() => setInputs(LAUNCH_LADDER_PRESETS[key])}
										>
											{label}
										</Button>
									))}
									{savedQuery.data ? (
										<Button
											size="xs"
											variant="default"
											onClick={() => {
												const saved = savedQuery.data;
												if (saved) setInputs(saved.inputs);
											}}
										>
											{i18n._("Reset to saved")}
										</Button>
									) : null}
									<Button
										size="xs"
										variant="default"
										loading={savedQuery.isFetching}
										onClick={async () => {
											const result = await savedQuery.refetch();
											if (result.data) setInputs(result.data.inputs);
										}}
									>
										{i18n._("Reload saved")}
									</Button>
								</Group>
							</Stack>
						</Grid.Col>

						<Grid.Col span={{ base: 12, md: 8 }}>
							{model ? (
								<Stack gap="md">
									<Stack gap={4}>
										<Group justify="space-between" align="baseline">
											<Text fw={600}>{i18n._("Liquidity profile")}</Text>
											<Text fz="xs" c="gray">
												{i18n._("L per range · price axis linear")}
											</Text>
										</Group>
										<LiquidityProfileChart model={model} />
										<Group gap="md" fz="xs" c="gray">
											{model.bands.map((band) => (
												<span key={band.key}>
													<i
														className={classes.swatch}
														style={{ background: BAND_COLORS[band.key] }}
													/>
													{bandName(band)}
												</span>
											))}
											{model.floor ? (
												<span>
													<i
														className={classes.swatch}
														style={{ background: FLOOR_COLOR }}
													/>
													{i18n._("Floor (USDC)")}
												</span>
											) : null}
											<span>{i18n._("Dashed line: launch price")}</span>
										</Group>
									</Stack>
									<Stack gap={4}>
										<Group justify="space-between" align="baseline">
											<Text fw={600}>
												{i18n._("Price against USDC bought")}
											</Text>
											<Text fz="xs" c="gray">
												{i18n._(
													"Hover for price, tokens sold and float % at any inflow",
												)}
											</Text>
										</Group>
										<BuyCurveChart model={model} />
									</Stack>
								</Stack>
							) : (
								<Text c="yellow" fz="sm">
									{"error" in validation ? validation.error : null}
								</Text>
							)}
						</Grid.Col>
					</Grid>

					{model ? (
						<Table.ScrollContainer minWidth={900}>
							<Table verticalSpacing="xs" fz="sm">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>{i18n._("Range")}</Table.Th>
										<Table.Th>{i18n._("Tick-aligned prices")}</Table.Th>
										<Table.Th>{i18n._("Ticks (lower → upper)")}</Table.Th>
										<Table.Th ta="right">SOLV3</Table.Th>
										<Table.Th ta="right">L</Table.Th>
										<Table.Th ta="right">{i18n._("USDC per +1%")}</Table.Th>
										<Table.Th ta="right">{i18n._("Avg fill")}</Table.Th>
										<Table.Th ta="right">{i18n._("Proceeds")}</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{model.floor ? (
										<Table.Tr>
											<Table.Td>
												<i
													className={classes.swatch}
													style={{ background: FLOOR_COLOR }}
												/>
												{i18n._("Floor")}{" "}
												<Text span c="gray">
													· USDC
												</Text>
											</Table.Td>
											<Table.Td className={classes.mono}>
												{fmtPrice(model.floor.priceLower)} →{" "}
												{fmtPrice(model.floor.priceUpper)}
											</Table.Td>
											<Table.Td className={classes.mono}>
												{model.floor.tickLower} → {model.floor.tickUpper}
											</Table.Td>
											<Table.Td ta="right" c="gray">
												{i18n._("absorbs")}{" "}
												{formatTokenAmount(model.floor.absorbsTokens, {
													decimals: 0,
												})}
											</Table.Td>
											<Table.Td ta="right" className={classes.mono}>
												{fmtLiquidity(model.floor.liquidity)}
											</Table.Td>
											<Table.Td ta="right">
												{fmtUsd(model.floor.usdcPerOnePercent)}
											</Table.Td>
											<Table.Td ta="right" c="gray">
												—
											</Table.Td>
											<Table.Td ta="right">
												{fmtUsd(model.floor.usdc)} {i18n._("placed")}
											</Table.Td>
										</Table.Tr>
									) : null}
									{model.bands.map((band) => (
										<Table.Tr key={band.key}>
											<Table.Td>
												<i
													className={classes.swatch}
													style={{ background: BAND_COLORS[band.key] }}
												/>
												{bandName(band)}{" "}
												<Text span c="gray">
													· {band.percent}%
												</Text>
											</Table.Td>
											<Table.Td className={classes.mono}>
												{fmtPrice(band.priceLower)} →{" "}
												{fmtPrice(band.priceUpper)}
											</Table.Td>
											<Table.Td className={classes.mono}>
												{band.tickLower} → {band.tickUpper}
											</Table.Td>
											<Table.Td ta="right">
												{formatTokenAmount(band.tokens, { decimals: 0 })}
											</Table.Td>
											<Table.Td ta="right" className={classes.mono}>
												{fmtLiquidity(band.liquidity)}
											</Table.Td>
											<Table.Td ta="right">
												{fmtUsd(band.usdcPerOnePercent)}
											</Table.Td>
											<Table.Td ta="right">
												{fmtPrice(band.averageFillPrice)}
											</Table.Td>
											<Table.Td ta="right">
												{fmtUsd(band.proceedsUsdc)}
											</Table.Td>
										</Table.Tr>
									))}
									<Table.Tr fw={600}>
										<Table.Td>{i18n._("Ladder total")}</Table.Td>
										<Table.Td className={classes.mono}>
											{fmtPrice(model.bands[0].priceLower)} →{" "}
											{fmtPrice(model.topPrice)}
										</Table.Td>
										<Table.Td className={classes.mono}>
											{model.bands[0].tickLower} → {model.bands[2].tickUpper}
										</Table.Td>
										<Table.Td ta="right">
											{formatTokenAmount(model.deployedTokens, { decimals: 0 })}
										</Table.Td>
										<Table.Td />
										<Table.Td />
										<Table.Td ta="right">
											{fmtPrice(
												model.totalProceedsUsdc /
													Math.max(1, model.deployedTokens),
											)}
										</Table.Td>
										<Table.Td ta="right">
											{fmtUsd(model.totalProceedsUsdc)}
										</Table.Td>
									</Table.Tr>
								</Table.Tbody>
							</Table>
						</Table.ScrollContainer>
					) : null}
					<Text fz="xs" c="gray">
						{i18n._(
							"Tokens in a range always sell for the geometric mean of its endpoints no matter how L is set — allocation decides proceeds, L (tokens ÷ range width) decides how much buying it takes to cross. \"USDC per +1%\" is measured at each range's geometric midpoint. Every boundary snaps to the fee tier's tick spacing, so these are the prices the pool will actually use.",
						)}
					</Text>
				</Stack>
			</CardLayout>

			{model ? (
				<Grid gutter="lg">
					<Grid.Col span={{ base: 12, md: 6 }}>
						<CardLayout h="100%">
							<Stack gap="sm">
								<Text fz="lg" fw="bold">
									{i18n._("On-chain setup")}
								</Text>
								<Table verticalSpacing={6} fz="sm" withRowBorders={false}>
									<Table.Tbody>
										{[
											[
												i18n._("Token A / B"),
												<span key="ab" className={classes.mono}>
													SOLV3 {formatAddress(LAUNCH_TOKEN_A_MINT, 6)}
													<br />
													USDC {formatAddress(LAUNCH_TOKEN_B_MINT, 6)}
												</span>,
											],
											[
												i18n._("Fee tier"),
												`${LAUNCH_FEE_TIERS.find((t) => t.tickSpacing === model.tickSpacing)?.label} · fee_rate ${model.feeRate} · tick_spacing ${model.tickSpacing} (${((1.0001 ** model.tickSpacing - 1) * 100).toFixed(2)}% ${i18n._("per step")})`,
											],
											[
												i18n._("Init tick"),
												<span key="init">
													{model.initTickIndex} ≈ {fmtPrice(model.initPrice)}
													<br />
													<Text span fz="xs" c="gray">
														sqrt_price ≈{" "}
														{model.initSqrtPriceX64Approx.toString()} (X64 —{" "}
														{i18n._(
															"take the exact value from the SDK's tickIndex → sqrtPriceX64",
														)}
														)
													</Text>
												</span>,
											],
											[
												i18n._("Tick arrays"),
												`${model.tickArrayStartIndices.length} ${i18n._("to initialize · start indices")} ${model.tickArrayStartIndices.join(", ")} · ≈ ${(model.tickArrayStartIndices.length * 0.07).toFixed(2)} SOL ${i18n._("rent as fixed arrays")}`,
											],
											[
												i18n._("Positions"),
												`${model.bands.length} ${i18n._("single-sided SOLV3")}${model.floor ? ` + 1 ${i18n._("USDC floor")}` : ""} · open_position_with_token_extensions ${i18n._("then")} increase_liquidity ${i18n._("with")} token_max_b = 0`,
											],
											[
												i18n._("Rent budget"),
												`≈ ${(model.tickArrayStartIndices.length * 0.07 + (model.bands.length + (model.floor ? 1 : 0)) * 0.01 + 0.05).toFixed(2)} SOL ${i18n._("incl. pool + vaults")}`,
											],
										].map(([label, value]) => (
											<Table.Tr key={String(label)}>
												<Table.Td c="gray" w={120} valign="top" fz="xs">
													{label}
												</Table.Td>
												<Table.Td style={{ wordBreak: "break-word" }}>
													{value}
												</Table.Td>
											</Table.Tr>
										))}
									</Table.Tbody>
								</Table>
							</Stack>
						</CardLayout>
					</Grid.Col>
					<Grid.Col span={{ base: 12, md: 6 }}>
						<CardLayout h="100%">
							<Stack gap="sm">
								<Group justify="space-between" align="baseline">
									<Text fz="lg" fw="bold">
										{i18n._("Deploy JSON")}
									</Text>
									<Button size="xs" variant="default" onClick={copyJson}>
										{i18n._("Copy JSON")}
									</Button>
								</Group>
								<Text fz="xs" c="gray">
									{i18n._(
										"Feed this to the deploy script and assert against it — don't recompute ticks from prices.",
									)}
								</Text>
								<pre className={classes.json}>{deployJson}</pre>
							</Stack>
						</CardLayout>
					</Grid.Col>
				</Grid>
			) : null}

			{model ? (
				isDirty ? (
					<CardLayout>
						<Text fz="sm" c="gray">
							Save the plan to enable the on-chain deploy panel — it only
							deploys the saved plan.
						</Text>
					</CardLayout>
				) : (
					<Stack gap="md">
						<AdminLaunchDeploy plan={ladderDeployJson(model)} />
						<AdminLaunchProfit plan={ladderDeployJson(model)} />
					</Stack>
				)
			) : null}

			{model ? (
				<CardLayout>
					<Stack gap="sm">
						<Text fz="lg" fw="bold">
							{i18n._("Demand scenarios")}
						</Text>
						<Text fz="sm" c="gray">
							{i18n._(
								"The ladder doesn't need to fill to work. This is where price lands and how much of the float has left the treasury for a given amount of net buying — the table to tune the shape against, and to read in reverse for retraces.",
							)}
						</Text>
						<Table.ScrollContainer minWidth={720}>
							<Table verticalSpacing="xs" fz="sm">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>{i18n._("Net USDC bought")}</Table.Th>
										<Table.Th ta="right">{i18n._("Price reached")}</Table.Th>
										<Table.Th>{i18n._("Where on the ladder")}</Table.Th>
										<Table.Th ta="right">{i18n._("SOLV3 sold")}</Table.Th>
										<Table.Th ta="right">{i18n._("% of float")}</Table.Th>
										<Table.Th ta="right">FDV</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{SCENARIO_INFLOWS.filter(
										(usdc) => usdc < model.totalProceedsUsdc,
									)
										.concat([model.totalProceedsUsdc])
										.map((usdc) => {
											const state = walkLadder(model, usdc);
											const band = model.bands[state.bandIndex];
											return (
												<Table.Tr key={usdc}>
													<Table.Td>
														{fmtUsd(usdc)}
														{usdc === model.totalProceedsUsdc
															? ` (${i18n._("full fill")})`
															: ""}
													</Table.Td>
													<Table.Td ta="right">
														{fmtPrice(state.price)}
													</Table.Td>
													<Table.Td>
														{state.exhausted
															? i18n._(
																	"heavy band exhausted — price leaves the ladder",
																)
															: `${bandName(band).toLowerCase()} ${i18n._("band")}, ${(state.bandProgress * 100).toFixed(0)}% ${i18n._("through")}`}
													</Table.Td>
													<Table.Td ta="right">
														{formatTokenAmount(state.tokensSold, {
															decimals: 0,
														})}
													</Table.Td>
													<Table.Td ta="right">
														{(
															(state.tokensSold / inputs.floatTokens) *
															100
														).toFixed(1)}
														%
													</Table.Td>
													<Table.Td ta="right">
														{fmtUsd(state.price * LAUNCH_TOTAL_SUPPLY)}
													</Table.Td>
												</Table.Tr>
											);
										})}
								</Table.Tbody>
							</Table>
						</Table.ScrollContainer>
					</Stack>
				</CardLayout>
			) : null}

			<CardLayout>
				<Stack gap="sm">
					<Text fz="lg" fw="bold">
						{i18n._("Execution runbook")}
					</Text>
					<Text fz="sm" c="gray">
						{i18n._(
							"In order. The pool must never exist on mainnet without its liquidity attached, and nothing gets announced until step 5 has been read back from chain.",
						)}
					</Text>
					<ol className={classes.steps}>
						{[
							[
								i18n._("Freeze the numbers."),
								i18n._(
									"Save the plan above, copy the deploy JSON and commit it next to the deploy script. Every tick in it is already a multiple of the fee tier's spacing; the script should assert against that file, not recompute ticks from prices.",
								),
							],
							[
								i18n._("Fund the deployer."),
								i18n._(
									'The float from the wallet assigned to Initial Liquidity in Tokenomics, roughly 1 SOL for rent (each fixed tick array ≈ 0.07 SOL, each position ≈ 0.01 SOL including its Token-2022 NFT), and the floor USDC if you use one. Confirm on-chain that the other eight allocations are already sitting in veSOLV3 locks — the "only the ladder is liquid" claim has to be true before it\'s said.',
								),
							],
							[
								i18n._("Rehearse on devnet."),
								i18n._(
									"Run the identical script against the devnet SOLV3/devUSDC config with the same fee tier and the same ticks. Check each position's liquidity against the L column (rounding only) and that the pool's token B vault is empty.",
								),
							],
							[
								i18n._("Deploy in one shot."),
								i18n._(
									"initialize_pool (SOLV3 as token A, USDC as token B, the chosen fee tier, sqrt_price for the init tick) → initialize_tick_array for every start index listed → open_position_with_token_extensions × 3 → increase_liquidity × 3 with token_max_b = 0 so the transaction fails if any USDC would be pulled. Submit as one Jito bundle. If you're placing a floor, open it last as a USDC-only position with token_max_a = 0.",
								),
							],
							[
								i18n._("Read it back before anyone else does."),
								i18n._(
									"Pool: sqrt_price resolves to the init tick, liquidity is 0 (nothing in range yet), vault A holds exactly the float, vault B holds exactly the floor. Each position: tick_lower_index, tick_upper_index and liquidity match the JSON.",
								),
							],
							[
								i18n._("Wire the gauge."),
								i18n._(
									"Create the pool's gauge (the Add Gauge tab) so the 100% protocol fee routes to voters and LP emissions can flow. Have the DAO Treasury lock vote for the SOLV3/USDC gauge in epoch 1; a modest bribe on the same gauge is the cheapest way to get other veSOLV3 voting there too.",
								),
							],
							[
								i18n._("Publish the exit rate."),
								i18n._(
									"The Exit Price tab publishes an admin-set rate, not oracle-derived. Seed it from the launch price and schedule an update once price has settled, since the 40% exit fee on permanent locks is charged against it.",
								),
							],
							[
								i18n._("Announce with receipts."),
								i18n._(
									"Pool address, the three position mints, the tick ranges, the fee tier, and the statement that all non-ladder supply is locked. Announce a time, not a slot.",
								),
							],
						].map(([title, body]) => (
							<li key={title}>
								<div>
									<Text fw={600} fz="sm">
										{title}
									</Text>
									<Text fz="sm" c="gray">
										{body}
									</Text>
								</div>
							</li>
						))}
					</ol>
				</Stack>
			</CardLayout>

			<Grid gutter="lg">
				<Grid.Col span={{ base: 12, md: 6 }}>
					<CardLayout h="100%">
						<Stack gap="md">
							<Text fz="lg" fw="bold">
								{i18n._("After launch")}
							</Text>
							{[
								[
									i18n._("Hours 0–24 · hands off"),
									i18n._(
										"Let the ladder do price discovery. Watch three things: token B vault growth per range (fill level), how deep retraces go, and whether a single wallet swept the thin band in the first slot.",
									),
								],
								[
									i18n._("As each range fills · it becomes the floor"),
									i18n._(
										"A range that price has crossed is now 100% USDC sitting just under the market — that's the retrace cushion. The thin band's cushion is only its Proceeds figure; until the medium band fills, that's all the bid depth there is. The optional floor exists for exactly this window.",
									),
								],
								[
									i18n._("After epoch 1 · consolidate into a market shape"),
									i18n._(
										"Close the fully-filled positions (pure USDC by then) and redeploy that USDC with unsold SOLV3 as a two-sided range around the settled price. This is why none of the launch positions should be permanently locked with lock_position: it's a strong trust signal but it removes this step.",
									),
								],
								[
									i18n._(
										"Every week from epoch 1 · emissions are the next float",
									),
									i18n._(
										"1.3M SOLV3 per week (−2% weekly) starts flowing to gauges — about a third of this ladder's size every week. Route the DAO's votes deliberately across pools; the heavy band is what absorbs farm-and-sell, so it shouldn't be the only gauge earning.",
									),
								],
								[
									i18n._("When price settles · add SOLV3/SOL"),
									i18n._(
										"For aggregator routing. In that pool WSOL sorts as token A, so price and ticks are inverted relative to this plan — derive its ranges from the SDK's price helpers rather than reusing any tick number here.",
									),
								],
							].map(([title, body]) => (
								<Stack key={title} gap={2}>
									<Text fw={600} fz="sm">
										{title}
									</Text>
									<Text fz="sm" c="gray">
										{body}
									</Text>
								</Stack>
							))}
						</Stack>
					</CardLayout>
				</Grid.Col>
				<Grid.Col span={{ base: 12, md: 6 }}>
					<CardLayout h="100%">
						<Stack gap="md">
							<Text fz="lg" fw="bold">
								{i18n._("Tradeoffs you're accepting")}
							</Text>
							{[
								[
									i18n._("Thin means cheap to sweep."),
									i18n._(
										"The thin band costs only its Proceeds figure to buy end-to-end. A bot that fills it in the first slot holds that whole allocation at the band's average price and sells into your medium-band buyers. Keep the thin band at 10% or more of the float, keep its range short, and don't publish a slot.",
									),
								],
								[
									i18n._("Retraces mirror the climb."),
									i18n._(
										"Falling through thin liquidity is exactly as fast as rising through it. The steeper the ratio, the sharper the drop when early buyers exit.",
									),
								],
								[
									i18n._("The ladder earns no swap fees."),
									i18n._(
										"The protocol fee rate is 100%, routed to the gauge for veSOLV3 voters. The treasury's return here is the USDC proceeds plus whatever its own locks earn by voting — not LP fees.",
									),
								],
								[
									i18n._("Tick granularity."),
									i18n._(
										"At spacing 128 each tick step is 1.29%, so every boundary you type snaps by up to ±0.65%. Use the tick-aligned prices in announcements.",
									),
								],
								[
									i18n._("Under-demand is fine, over-demand is a wall."),
									i18n._(
										"If buying stops inside the medium band, unsold SOLV3 just stays in the treasury's positions. If buying exhausts the heavy band, price leaves the ladder with no liquidity above it; the consolidation step is what should catch that.",
									),
								],
								[
									i18n._("Locking vs. flexibility."),
									i18n._(
										"lock_position is permanent and only applies to Token-2022 positions. Lock nothing at launch and decide after consolidation, when the two-sided position is the one worth locking as a public commitment.",
									),
								],
							].map(([title, body]) => (
								<Stack key={title} gap={2}>
									<Text fw={600} fz="sm">
										{title}
									</Text>
									<Text fz="sm" c="gray">
										{body}
									</Text>
								</Stack>
							))}
						</Stack>
					</CardLayout>
				</Grid.Col>
			</Grid>
		</Stack>
	);
};
