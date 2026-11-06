import type { PriceInputs } from "@/stores/pool";

export interface ChartEntry {
	activeLiquidity: number;
	price0: number;
}

interface Dimensions {
	width: number;
	height: number;
}

interface Margins {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface ZoomLevels {
	initialMin: number;
	initialMax: number;
	min: number;
	max: number;
}

export interface LiquidityChartRangeInputProps {
	id?: string;
	data: {
		series: ChartEntry[];
		current: number;
	};
	ticksAtLimit: { [bound in PriceInputs]?: boolean | undefined };
	styles: {
		area: {
			selection: string;
			opacity?: number;
		};

		brush: {
			handle: {
				west: string;
				east: string;
			};
		};
	};
	dimensions: Dimensions;
	margins: Margins;
	interactive?: boolean;
	brushLabels: (d: "w" | "e", x: number) => string;
	brushDomain?: [number, number];
	onBrushDomainChange: (
		domain: [number, number],
		mode: string | undefined,
	) => void;
	zoomLevels: ZoomLevels;
	hideBrushes?: boolean;
}

export enum HandleType {
	e = "e",
	w = "w",
}
