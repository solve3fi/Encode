import type { ScaleLinear } from "d3";
import { type FC, useMemo } from "react";

interface LineProps {
	value: number;
	xScale: ScaleLinear<number, number>;
	innerHeight: number;
}

/** The current price: a dashed vertical line with a dot at the top. */
export const Line: FC<LineProps> = ({ value, xScale, innerHeight }) =>
	useMemo(() => {
		const x = xScale(value);
		return (
			<g pointerEvents="none">
				<line
					x1={x}
					y1={6}
					x2={x}
					y2={innerHeight}
					stroke="#58d7ff"
					strokeWidth={1.5}
					strokeDasharray="4 4"
					opacity={0.9}
				/>
				<circle cx={x} cy={6} r={4} fill="#58d7ff" />
				<circle cx={x} cy={6} r={8} fill="#58d7ff" opacity={0.18} />
			</g>
		);
	}, [value, xScale, innerHeight]);
