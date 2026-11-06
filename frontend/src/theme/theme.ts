"use client";

import { Button, createTheme, NumberInput, Overlay, rem } from "@mantine/core";

// Replace an initial zero on typing without changing the amount just by focusing.
const selectZero = (event: React.SyntheticEvent<HTMLInputElement>) => {
	const input = event.currentTarget;
	const numericText = input.value.replace(/[$,%\s]/g, "");
	if (!input.readOnly && /^-?0+(?:\.0+)?$/.test(numericText)) {
		input.select();
	}
};

export const theme = createTheme({
	primaryColor: "purple",
	breakpoints: {
		xxs: "20em",
		xs: "30em",
		sm: "48em",
		md: "64em",
		lg: "74em",
		xl: "120em", // 90rem
	},
	colors: {
		dark: [
			"#F9FAFB",
			"#F3F4F6",
			"#E5E7EB",
			"#D1D5DB",
			"#111827",
			"#6B7280",
			"#171717",
			"#000000",
			"#1F2937",
			"#111827",
			"#141428",
		],
		gray: [
			"#FFFFFF",
			"#F2F2F2",
			"#E5E5E5",
			"#D9D9D9",
			"#CCCCCC",
			"#BFBFBF",
			"#B3B3B3",
			"#A6A6A6",
			"#999999",
			"#8C8C8C",
			"#808080",
			"#737373",
			"#666666",
			"#595959",
			"#4D4D4D",
			"#404040",
			"#2A2A48",
			"#1A1A33",
			"#141428",
			"#0E0E1C",
			"#000000",
			"#D2D2D2",
			"#828282",
			"#F6F5F9", //23
			"#F7F7F7",
		],
		purple: [
			"#ECEBFF",
			"#D6CFFC",
			"#C3B8F9",
			"#FFFFFF",
			"#9F8FEF",
			"#8C84FF",
			"#5036D1",
			"#705CD6",
			"#624DCB",
			"#685DF7",
			"#5036D1",
			"#3D29A3",
			"#321F93",
			"#291782",
			"#201070",
			"#180A5C",
			"#110647",
			"#0A0330",
			"#040116",
			"#B1A3F5",
			"#180A5C",
			"#8A87AF", //21
			"#685DF7",
		],
		success: [
			"#ECFDF5",
			"#D1FAE5",
			"#A7F3D0",
			"#6EE7B7",
			"#34D399",
			"#10B981",
			"#059669",
			"#99F6EE",
			"#14B8A9",
			"#0F766D",
			"#00B8A1",
		],
		error: [
			"#FEF2F2",
			"#FEE2E2",
			"#FECACA",
			"#FCA5A5",
			"#F87171",
			"#EF4444",
			"#DC2626",
			"#F6ABAB",
			"#E44F4F",
			"#991B1B",
		],
	},
	components: {
		NumberInput: NumberInput.extend({
			defaultProps: {
				allowLeadingZeros: false,
				onFocus: selectZero,
				onClick: selectZero,
			},
		}),
		Overlay: Overlay.extend({}),
		Button: Button.extend({
			vars: (_, props) => {
				if (props.size === "xxs") {
					return {
						root: {
							"--button-height": rem(24),
							"--button-padding-x": rem(10),
							"--button-fz": rem(10),
						},
					};
				}
				return { root: {} };
			},
		}),
	},
});
