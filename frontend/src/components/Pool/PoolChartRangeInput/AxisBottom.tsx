import {
	axisBottom,
	type Axis as d3Axis,
	format,
	type NumberValue,
	type ScaleLinear,
	select,
} from "d3";
import { type FC, useMemo } from "react";

interface AxisProps {
	axisGenerator: d3Axis<NumberValue>;
}

const Axis: FC<AxisProps> = ({ axisGenerator }) => {
	const axisRef = (axis: SVGGElement) => {
		if (!axis) return;
		select(axis)
			.call(axisGenerator)
			.call((g) => g.select(".domain").remove())
			.call((g) => g.selectAll(".tick line").remove())
			.call((g) =>
				g
					.selectAll(".tick text")
					.attr("fill", "#a6a4b8")
					.attr("font-size", 11)
					.attr("font-weight", 500)
					.attr("dy", "0.9em"),
			);
	};

	return <g ref={axisRef} />;
};

interface AxisBottomProps {
	xScale: ScaleLinear<number, number>;
	innerHeight: number;
	offset?: number;
}

/** Decimals that keep neighbouring ticks distinct at the current zoom (104.30 / 104.35, but 50 / 100 / 150). */
const tickFormatFor = (xScale: ScaleLinear<number, number>) => {
	const [a, b] = xScale.domain();
	const step = Math.abs(b - a) / 5;
	const decimals =
		step > 0 && Number.isFinite(step)
			? Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
			: 2;
	return format(`,.${decimals}f`);
};

export const AxisBottom: FC<AxisBottomProps> = ({
	xScale,
	innerHeight,
	offset = 0,
}) =>
	useMemo(
		() => (
			<g transform={`translate(0, ${innerHeight + offset})`}>
				<Axis
					axisGenerator={axisBottom(xScale)
						.ticks(5)
						.tickSize(0)
						.tickFormat((v) => tickFormatFor(xScale)(Number(v)))}
				/>
			</g>
		),
		[innerHeight, offset, xScale],
	);
