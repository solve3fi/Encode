import { useLingui } from "@lingui/react";
import { SegmentedControl, Text } from "@mantine/core";

import { useApplication } from "@/stores/application/ApplicationProvider";
import classes from "./SwapMethod.module.css";

export const SwapMethod: React.FC = () => {
	const { i18n } = useLingui();
	const swapType = useApplication((state) => state.swapType);

	return (
		<SegmentedControl
			color="purple.10"
			classNames={classes}
			value={swapType}
			size="lg"
			data={[
				{
					value: "swap",
					label: (
						<Text fw={600} px={5}>
							{i18n._("Swap")}
						</Text>
					),
				},
			]}
		/>
	);
};
