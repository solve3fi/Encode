import { Be_Vietnam_Pro } from "next/font/google";
import localFont from "next/font/local";

export const bevn = Be_Vietnam_Pro({
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
	variable: "--be-vietnam-pro",
	display: "swap",
});

export const funnel = localFont({
	src: [
		{
			path: "./funnel-fonts/FunnelDisplay-Regular.ttf",
			weight: "400",
			style: "normal",
		},
		{
			path: "./funnel-fonts/FunnelDisplay-Light.ttf",
			weight: "300",
			style: "normal",
		},
		{
			path: "./funnel-fonts/FunnelDisplay-Medium.ttf",
			weight: "500",
			style: "normal",
		},
		{
			path: "./funnel-fonts/FunnelDisplay-Bold.ttf",
			weight: "600",
			style: "normal",
		},
		{
			path: "./funnel-fonts/FunnelDisplay-SemiBold.ttf",
			weight: "700",
			style: "normal",
		},
	],
	variable: "--funnel-fonts",
	display: "swap",
	preload: false,
});
