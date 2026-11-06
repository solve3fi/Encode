import { Stack } from "@mantine/core";
import { max, scaleLinear, type ZoomTransform } from "d3";
import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { PriceInputs } from "@/stores/pool";
import { Area } from "./Area";
import { AxisBottom } from "./AxisBottom";
import { Brush } from "./Brush";
import { Line } from "./Line";
import type { ChartEntry, LiquidityChartRangeInputProps } from "./types";
import { Zoom } from "./Zoom";

const xAccessor = (d: ChartEntry) => d.price0;
const yAccessor = (d: ChartEntry) => d.activeLiquidity;

export const Chart: FC<LiquidityChartRangeInputProps> = ({
	id = "liquidityChartRangeInput",
	data: { series, current },
	ticksAtLimit,
	styles,
	dimensions: { width, height },
	margins,
	interactive = true,
	brushDomain,
	brushLabels,
	onBrushDomainChange,
	zoomLevels,
	hideBrushes,
}) => {
	const zoomRef = useRef<SVGRectElement | null>(null);
	const [zoom, setZoom] = useState<ZoomTransform | null>();

	const [innerHeight, innerWidth] = useMemo(
		() => [
			height - margins.top - margins.bottom,
			width - margins.left - margins.right,
		],
		[width, height, margins],
	);

	const { xScale, yScale } = useMemo(() => {
		const scales = {
			xScale: scaleLinear()
				.domain([
					current * zoomLevels.initialMin,
					current * zoomLevels.initialMax,
				] as number[])
				.range([0, innerWidth]),
			yScale: scaleLinear()
				.domain([0, max(series, yAccessor)] as number[])
				.range([innerHeight, 0]),
		};

		if (zoom) {
			const newXscale = zoom.rescaleX(scales.xScale);
			scales.xScale.domain(newXscale.domain());
		}

		return scales;
	}, [
		current,
		zoomLevels.initialMin,
		zoomLevels.initialMax,
		innerWidth,
		series,
		innerHeight,
		zoom,
	]);

	useEffect(() => {
		setZoom(null);
	}, []);

	// The selected range as a band across the chart: it stays clear with no liquidity data, and "full range" fills it all.
	const bandStart = brushDomain
		? Math.min(innerWidth, Math.max(0, xScale(brushDomain[0])))
		: 0;
	const bandEnd = brushDomain
		? Math.min(innerWidth, Math.max(0, xScale(brushDomain[1])))
		: 0;

	useEffect(() => {
		if (!brushDomain) {
			onBrushDomainChange(xScale.domain() as [number, number], undefined);
		}
	}, [brushDomain, onBrushDomainChange, xScale]);

	return (
		<Stack pos="relative" gap={0}>
			<Zoom
				svg={zoomRef.current}
				xScale={xScale}
				setZoom={setZoom}
				width={innerWidth}
				height={height}
				resetBrush={() => {
					onBrushDomainChange(
						[
							current * zoomLevels.initialMin,
							current * zoomLevels.initialMax,
						] as [number, number],
						"reset",
					);
				}}
				showResetButton={Boolean(
					ticksAtLimit[PriceInputs.LOWER] || ticksAtLimit[PriceInputs.UPPER],
				)}
				zoomLevels={zoomLevels}
			/>
			<svg
				width="100%"
				height="100%"
				viewBox={`0 0 ${width} ${height}`}
				style={{ overflow: "visible" }}
			>
				<title>Chart</title>
				<defs>
					<clipPath id={`${id}-chart-clip`}>
						<rect x="0" y="0" width={innerWidth} height={height} />
					</clipPath>

					<linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
						<stop
							offset="0%"
							stopColor={styles.area.selection}
							stopOpacity={0.55}
						/>
						<stop
							offset="100%"
							stopColor={styles.area.selection}
							stopOpacity={0.05}
						/>
					</linearGradient>

					{brushDomain && !hideBrushes && (
						<mask id={`${id}-chart-area-mask`}>
							<rect
								fill="white"
								x={xScale(brushDomain[0])}
								y="0"
								width={xScale(brushDomain[1]) - xScale(brushDomain[0])}
								height={innerHeight}
							/>
						</mask>
					)}
				</defs>

				<g transform={`translate(${margins.left},${margins.top})`}>
					<rect
						width={innerWidth}
						height={innerHeight}
						rx={10}
						fill="#10102a"
						stroke="rgba(160, 152, 255, 0.14)"
					/>
					<g clipPath={`url(#${id}-chart-clip)`}>
						{[0.25, 0.5, 0.75].map((f) => (
							<line
								key={f}
								x1={0}
								x2={innerWidth}
								y1={innerHeight * f}
								y2={innerHeight * f}
								stroke="rgba(246, 245, 249, 0.06)"
							/>
						))}
						{xScale.ticks(5).map((t) => (
							<line
								key={t}
								x1={xScale(t)}
								x2={xScale(t)}
								y1={0}
								y2={innerHeight}
								stroke="rgba(246, 245, 249, 0.05)"
							/>
						))}
						{brushDomain && !hideBrushes && bandEnd > bandStart && (
							<g pointerEvents="none">
								<rect
									x={bandStart}
									y={0}
									width={bandEnd - bandStart}
									height={innerHeight}
									fill={`url(#${id}-band)`}
								/>
								<line
									x1={bandStart}
									x2={bandEnd}
									y1={1}
									y2={1}
									stroke={styles.area.selection}
									strokeWidth={2}
								/>
								{bandStart > 0 && (
									<rect
										x={0}
										y={0}
										width={bandStart}
										height={innerHeight}
										fill="rgba(7, 7, 18, 0.35)"
									/>
								)}
								{bandEnd < innerWidth && (
									<rect
										x={bandEnd}
										y={0}
										width={innerWidth - bandEnd}
										height={innerHeight}
										fill="rgba(7, 7, 18, 0.35)"
									/>
								)}
							</g>
						)}
						<Area
							series={series}
							xScale={xScale}
							yScale={yScale}
							xValue={xAccessor}
							yValue={yAccessor}
							fill={styles.area.selection}
							opacity={styles.area.opacity}
						/>

						{brushDomain && !hideBrushes && (
							<g mask={`url(#${id}-chart-area-mask)`}>
								<Area
									series={series}
									xScale={xScale}
									yScale={yScale}
									xValue={xAccessor}
									yValue={yAccessor}
									fill={styles.area.selection}
								/>
							</g>
						)}

						<Line value={current} xScale={xScale} innerHeight={innerHeight} />
						<AxisBottom xScale={xScale} innerHeight={innerHeight} />
					</g>

					<rect
						fill="transparent"
						className="cursor-grab active:cursor-grabbing"
						width={innerWidth}
						height={height}
						ref={zoomRef}
					/>

					{!hideBrushes && (
						<Brush
							id={id}
							xScale={xScale}
							interactive={interactive}
							brushLabelValue={brushLabels}
							brushExtent={brushDomain ?? (xScale.domain() as [number, number])}
							innerWidth={innerWidth}
							innerHeight={innerHeight}
							setBrushExtent={onBrushDomainChange}
							westHandleColor={styles.brush.handle.west}
							eastHandleColor={styles.brush.handle.east}
						/>
					)}
				</g>
			</svg>
		</Stack>
	);
};
