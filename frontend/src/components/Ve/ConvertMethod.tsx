import { useLingui } from "@lingui/react";
import { SegmentedControl, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import classes from "./ConvertMethod.module.css";

export type ConvertMethodProps = {
	method: "ve-yeve" | "x-yeve" | "zero-fee";
};

export const ConvertMethod: React.FC<ConvertMethodProps> = ({ method }) => {
	const { i18n } = useLingui();
	const router = useRouter();

	const handleSegmentedControlChange = useCallback(
		(value: string) => {
			router.push(`/${value}`, { scroll: false });
		},
		[router],
	);

	return (
		<SegmentedControl
			color="purple.10"
			classNames={classes}
			defaultValue={method}
			size="lg"
			withItemsBorders={false}
			onChange={handleSegmentedControlChange}
			data={[
				{
					value: "ve-yeve",
					label: (
						<Text fw={600} px={5}>
							{i18n._("SOLV3")}
						</Text>
					),
				},
				{
					value: "x-yeve",
					label: (
						<Text fw={600} px={5}>
							{i18n._("veSOLV3")}
						</Text>
					),
				},
				{
					value: "zero-fee",
					label: (
						<Text fw={600} px={5}>
							{i18n._("Zero fee")}
						</Text>
					),
				},
			]}
		/>
	);
};
