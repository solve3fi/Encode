/*
 * Generates an SVG path for the east brush handle.
 * Apply `scale(-1, 1)` to generate west brush handle.
 *
 *    |```````\
 *    |  | |  |
 *    |______/
 *    |
 *    |
 *    |
 *    |
 *    |
 *
 * https://medium.com/@dennismphil/one-side-rounded-rectangle-using-svg-fb31cf318d90
 */
export const brushHandlePath = (height: number) =>
	[
		// handle
		"M 0 0", // move to origin
		`v ${height}`, // vertical line
		"m 1 0", // move 1px to the right
		"V 0", // second vertical line
		"M 0 1", // move to origin

		// head
		"h 12", // horizontal line
		"q 2 0, 2 2", // rounded corner
		"v 22", // vertical line
		"q 0 2 -2 2", // rounded corner
		"h -12", // horizontal line
		"z", // close path
	].join(" ");

export const brushHandleAccentPath = () =>
	[
		"m 5 7", // move to first accent
		"v 14", // vertical line
		"M 0 0", // move to origin
		"m 9 7", // move to second accent
		"v 14", // vertical line
		"z",
	].join(" ");

/**
 * A small pill at the chart edge for a bound that is outside the visible prices (0, infinity, or far away). It shows the
 * bound's label and points the way to it. `side` "w" sits on the left edge, "e" on the right.
 */
export const OffScreenHandle = ({
	color,
	label,
	side,
}: {
	color: string;
	label: string;
	side: "w" | "e";
}) => {
	const west = side === "w";
	return (
		<g transform={`translate(${west ? 8 : -56}, 8)`}>
			<rect
				width={48}
				height={24}
				rx={12}
				fill="#1d1c3f"
				stroke={color}
				strokeWidth={1.5}
			/>
			<path
				d={west ? "M 14 12 l 5 -5 v 10 z" : "M 34 12 l -5 -5 v 10 z"}
				fill={color}
			/>
			<text
				x={west ? 31 : 17}
				y={12.5}
				textAnchor="middle"
				dominantBaseline="middle"
				fontSize={12}
				fontWeight={600}
				fill="#ffffff"
			>
				{label}
			</text>
		</g>
	);
};
