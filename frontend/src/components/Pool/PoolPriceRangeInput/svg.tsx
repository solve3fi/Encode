import type React from "react";

export const Points: React.FC<{
	active: number;
	activeColor: string;
	inactiveColor: string;
	total: number;
	width: number;
	height: number;
	space?: number;
}> = ({ active, activeColor, inactiveColor, total, width, height, space }) => {
	return (
		<svg
			width={`${total * width + (space || 5) * (total - 1)}px`}
			height={`${height}px`}
			viewBox={`0 0 ${total * width + (space || 5) * (total - 1)} ${height}`}
			version="1.1"
			xmlns="http://www.w3.org/2000/svg"
			xmlnsXlink="http://www.w3.org/1999/xlink"
		>
			<title>Point</title>
			<g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
				{Array.from({ length: total }).map((_, i) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: false
						key={i}
						id="Oval"
						fill={active > i ? activeColor : inactiveColor}
						cx={i * (width + (space || 5)) + width / 2}
						cy={width / 2}
						r={width / 2}
					/>
				))}
			</g>
		</svg>
	);
};
