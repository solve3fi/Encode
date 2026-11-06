import { usePrevious } from "@mantine/hooks";
import {
	type BrushBehavior,
	brushX,
	type D3BrushEvent,
	type ScaleLinear,
	select,
} from "d3";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { brushHandleAccentPath, brushHandlePath, OffScreenHandle } from "./svg";

const FLIP_HANDLE_THRESHOLD_PX = 20;
const BRUSH_EXTENT_MARGIN_PX = 2;

const compare = (
	a: [number, number],
	b: [number, number],
	xScale: ScaleLinear<number, number>,
): boolean => {
	const aNorm = a.map((x) => xScale(x)?.toFixed(1));
	const bNorm = b.map((x) => xScale(x)?.toFixed(1));
	return aNorm.every((v, i) => v === bNorm[i]);
};

interface BrushProps {
	id: string;
	xScale: ScaleLinear<number, number>;
	interactive: boolean;
	brushLabelValue: (d: "w" | "e", x: number) => string;
	brushExtent: [number, number];
	setBrushExtent: (extent: [number, number], mode: string | undefined) => void;
	innerWidth: number;
	innerHeight: number;
	westHandleColor: string;
	eastHandleColor: string;
}

export const Brush: FC<BrushProps> = ({
	id,
	xScale,
	interactive,
	brushLabelValue,
	setBrushExtent,
	brushExtent,
	innerWidth,
	innerHeight,
	westHandleColor,
	eastHandleColor,
}) => {
	const brushRef = useRef<SVGGElement | null>(null);
	const brushBehavior = useRef<BrushBehavior<SVGGElement> | null>(null);

	const [localBrushExtent, setLocalBrushExtent] = useState<
		[number, number] | null
	>(brushExtent);
	const [showLabels, setShowLabels] = useState(false);
	const [hovering, setHovering] = useState(false);

	const previousBrushExtent = usePrevious(brushExtent);

	const brushed = useCallback(
		(event: D3BrushEvent<unknown>) => {
			const { type, selection, mode } = event;

			if (!selection) {
				setLocalBrushExtent(null);
				return;
			}

			const scaled = (selection as [number, number]).map(xScale.invert) as [
				number,
				number,
			];

			if (type === "end" && !compare(brushExtent, scaled, xScale)) {
				setBrushExtent(scaled, mode);
			}

			setLocalBrushExtent(scaled);
		},
		[brushExtent, setBrushExtent, xScale],
	);

	useEffect(() => {
		setLocalBrushExtent(brushExtent);
	}, [brushExtent]);

	useEffect(() => {
		if (!brushRef.current) return;
		brushBehavior.current = brushX<SVGGElement>()
			.extent([
				[Math.max(0 + BRUSH_EXTENT_MARGIN_PX, xScale(0)), 0],
				[innerWidth - BRUSH_EXTENT_MARGIN_PX, innerHeight],
			])
			.handleSize(30)
			.filter(() => interactive)
			.on("brush end", brushed);

		brushBehavior.current(select(brushRef.current));

		if (
			previousBrushExtent &&
			compare(brushExtent, previousBrushExtent, xScale)
		) {
			select(brushRef.current)
				.transition()
				// biome-ignore lint/suspicious/noExplicitAny: false
				.call(brushBehavior.current.move as any, brushExtent.map(xScale));
		}

		// brush linear gradient
		select(brushRef.current)
			.selectAll(".selection")
			.attr("stroke", "none")
			.attr("fill-opacity", "0.1")
			.attr("fill", `url(#${id}-gradient-selection)`);
	}, [
		brushExtent,
		brushed,
		id,
		innerHeight,
		innerWidth,
		interactive,
		previousBrushExtent,
		xScale,
	]);

	// respond to xScale changes only
	useEffect(() => {
		if (!brushRef.current || !brushBehavior.current) return;

		brushBehavior.current.move(
			// biome-ignore lint/suspicious/noExplicitAny: false
			select(brushRef.current) as any,
			// biome-ignore lint/suspicious/noExplicitAny: false
			brushExtent.map(xScale) as any,
		);
	}, [brushExtent, xScale]);

	useEffect(() => {
		setShowLabels(true);
		const timeout = setTimeout(() => setShowLabels(false), 1500);
		return () => clearTimeout(timeout);
	}, []);

	const flipWestHandle =
		localBrushExtent && xScale(localBrushExtent[0]) > FLIP_HANDLE_THRESHOLD_PX;
	const flipEastHandle =
		localBrushExtent &&
		xScale(localBrushExtent[1]) > innerWidth - FLIP_HANDLE_THRESHOLD_PX;

	const showWestArrow =
		localBrushExtent &&
		(xScale(localBrushExtent[0]) < 0 || xScale(localBrushExtent[1]) < 0);
	const showEastArrow =
		localBrushExtent &&
		(xScale(localBrushExtent[0]) > innerWidth ||
			xScale(localBrushExtent[1]) > innerWidth);

	const westHandleInView =
		localBrushExtent &&
		xScale(localBrushExtent[0]) >= 0 &&
		xScale(localBrushExtent[0]) <= innerWidth;
	const eastHandleInView =
		localBrushExtent &&
		xScale(localBrushExtent[1]) >= 0 &&
		xScale(localBrushExtent[1]) <= innerWidth;

	return useMemo(
		() => (
			<>
				<defs>
					<linearGradient
						id={`${id}-gradient-selection`}
						x1="0%"
						y1="100%"
						x2="100%"
						y2="100%"
					>
						<stop stopColor={westHandleColor} />
						<stop stopColor={eastHandleColor} offset="1" />
					</linearGradient>

					<clipPath id={`${id}-brush-clip`}>
						<rect x="0" y="0" width={innerWidth} height={innerHeight} />
					</clipPath>
				</defs>

				{/** biome-ignore lint/a11y/noStaticElementInteractions: false */}
				<g
					ref={brushRef}
					clipPath={`url(#${id}-brush-clip)`}
					onMouseEnter={() => setHovering(true)}
					onMouseLeave={() => setHovering(false)}
				/>

				{localBrushExtent && (
					<>
						{westHandleInView && (
							<g
								transform={`translate(${Math.max(
									0,
									xScale(localBrushExtent[0]),
								)}, 0), scale(${flipWestHandle ? "-1" : "1"}, 1)`}
							>
								<g>
									<path
										cursor="ew-resize"
										pointerEvents="none"
										strokeWidth={3}
										stroke={westHandleColor}
										fill={westHandleColor}
										d={brushHandlePath(innerHeight)}
									/>
									<path
										cursor="ew-resize"
										pointerEvents="none"
										strokeWidth={1.5}
										stroke="currentColor"
										className="text-white"
										opacity={0.6}
										d={brushHandleAccentPath()}
									/>
								</g>

								<g
									className="transition-opacity duration-300"
									opacity={showLabels || hovering ? 1 : 0}
									transform={`translate(50,0), scale(${
										flipWestHandle ? "1" : "-1"
									}, 1)`}
								>
									<rect
										fill="#1d1c3f"
										stroke="rgba(160, 152, 255, 0.5)"
										y="1"
										x="-30"
										height="22"
										width="46"
										rx="11"
									/>
									<text
										textAnchor="middle"
										fontSize={12}
										fontWeight={600}
										fill="#ffffff"
										transform="scale(-1, 1)"
										y="12.5"
										x="7"
										dominantBaseline="middle"
									>
										{brushLabelValue("w", localBrushExtent[0])}
									</text>
								</g>
							</g>
						)}

						{eastHandleInView && (
							<g
								transform={`translate(${xScale(
									localBrushExtent[1],
								)}, 0), scale(${flipEastHandle ? "-1" : "1"}, 1)`}
							>
								<g>
									<path
										cursor="ew-resize"
										pointerEvents="none"
										strokeWidth={3}
										stroke={eastHandleColor}
										fill={eastHandleColor}
										color={eastHandleColor}
										d={brushHandlePath(innerHeight)}
									/>
									<path
										cursor="ew-resize"
										pointerEvents="none"
										strokeWidth={1.5}
										stroke="currentColor"
										className="text-white"
										opacity={0.6}
										d={brushHandleAccentPath()}
									/>
								</g>

								<g
									className="transition-opacity duration-300"
									opacity={showLabels || hovering ? 1 : 0}
									transform={`translate(50,0), scale(${
										flipEastHandle ? "-1" : "1"
									}, 1)`}
								>
									<rect
										fill="#1d1c3f"
										stroke="rgba(160, 152, 255, 0.5)"
										y="1"
										x="-30"
										height="22"
										width="46"
										rx="11"
									/>
									<text
										textAnchor="middle"
										fontSize={12}
										fontWeight={600}
										fill="#ffffff"
										y="12.5"
										x="-7"
										dominantBaseline="middle"
									>
										{brushLabelValue("e", localBrushExtent[1])}
									</text>
								</g>
							</g>
						)}

						{showWestArrow && (
							<OffScreenHandle
								side="w"
								color={westHandleColor}
								label={brushLabelValue("w", localBrushExtent[0])}
							/>
						)}

						{showEastArrow && (
							<g transform={`translate(${innerWidth}, 0)`}>
								<OffScreenHandle
									side="e"
									color={eastHandleColor}
									label={brushLabelValue("e", localBrushExtent[1])}
								/>
							</g>
						)}
					</>
				)}
			</>
		),
		[
			brushLabelValue,
			eastHandleColor,
			eastHandleInView,
			flipEastHandle,
			flipWestHandle,
			hovering,
			id,
			innerHeight,
			innerWidth,
			localBrushExtent,
			showEastArrow,
			showLabels,
			showWestArrow,
			westHandleColor,
			westHandleInView,
			xScale,
		],
	);
};
