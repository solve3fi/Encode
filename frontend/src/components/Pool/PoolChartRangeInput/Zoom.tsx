import { useLingui } from "@lingui/react";
import { Button, Flex, Group } from "@mantine/core";
import { IconZoomIn, IconZoomOut } from "@tabler/icons-react";
import {
	type ScaleLinear,
	select,
	type ZoomBehavior,
	type ZoomTransform,
	zoom,
	zoomIdentity,
} from "d3";
import { type FC, useEffect, useMemo, useRef } from "react";
import type { ZoomLevels } from "./types";

interface ZoomProps {
	svg: SVGElement | null;
	xScale: ScaleLinear<number, number>;
	setZoom: (transform: ZoomTransform) => void;
	width: number;
	height: number;
	resetBrush: () => void;
	showResetButton: boolean;
	zoomLevels: ZoomLevels;
}

export const Zoom: FC<ZoomProps> = ({
	svg,
	xScale,
	setZoom,
	width,
	height,
	resetBrush,
	showResetButton,
	zoomLevels,
}) => {
	const { i18n } = useLingui();
	const zoomBehavior = useRef<ZoomBehavior<Element, unknown>>(null);

	const [zoomIn, zoomOut, zoomInitial, zoomReset] = useMemo(
		() => [
			() =>
				svg &&
				zoomBehavior.current &&
				select(svg as Element)
					.transition()
					.call(zoomBehavior.current.scaleBy, 2),
			() =>
				svg &&
				zoomBehavior.current &&
				select(svg as Element)
					.transition()
					.call(zoomBehavior.current.scaleBy, 0.5),
			() =>
				svg &&
				zoomBehavior.current &&
				select(svg as Element)
					.transition()
					.call(zoomBehavior.current.scaleTo, 0.5),
			() =>
				svg &&
				zoomBehavior.current &&
				select(svg as Element)
					.call(
						zoomBehavior.current.transform,
						zoomIdentity.translate(0, 0).scale(1),
					)
					.transition()
					.call(zoomBehavior.current.scaleTo, 0.5),
		],
		[svg],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: false
	useEffect(() => {
		if (!svg) return;
		zoomBehavior.current = zoom()
			.scaleExtent([zoomLevels.min, zoomLevels.max])
			.extent([
				[0, 0],
				[width, height],
			])
			.on("zoom", ({ transform }: { transform: ZoomTransform }) =>
				setZoom(transform),
			);

		select(svg as Element).call(zoomBehavior.current);
	}, [
		height,
		width,
		setZoom,
		svg,
		xScale,
		zoomBehavior,
		zoomLevels,
		zoomLevels.max,
		zoomLevels.min,
	]);

	useEffect(() => {
		zoomInitial();
	}, [zoomInitial]);

	return (
		<Flex pos="relative" justify="flex-end" align="flex-end" right={0} gap={5}>
			{showResetButton && (
				<Button
					size="xs"
					variant="light"
					disabled={!showResetButton}
					onClick={() => {
						resetBrush();
						zoomReset();
					}}
				>
					{i18n._("Clear all")}
				</Button>
			)}
			<Group gap={5}>
				<Button size="xs" variant="light" onClick={zoomIn} disabled={false}>
					<IconZoomIn size={16} stroke={1.5} />
				</Button>
				<Button size="xs" variant="light" onClick={zoomOut} disabled={false}>
					<IconZoomOut size={16} stroke={1.5} />
				</Button>
			</Group>
		</Flex>
	);
};
