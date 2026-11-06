"use client";

import { useLingui } from "@lingui/react";
import { SegmentedControl, Text } from "@mantine/core";
import { RewardMethods } from "@/stores/reward";
import { useReward, useRewardActions } from "@/stores/reward/RewardProvider";
import classes from "./RewardMethod.module.css";

export const RewardMethod: React.FC = () => {
	const { i18n } = useLingui();
	const method = useReward((state) => state.method);
	const { setMethod } = useRewardActions();

	return (
		<SegmentedControl
			color="purple.10"
			classNames={classes}
			value={method}
			size="md"
			onChange={(value) => setMethod(value as RewardMethods)}
			data={[
				{
					value: RewardMethods.LIQUIDITY,
					label: (
						<Text fw={600} px={5}>
							{i18n._("LP earnings")}
						</Text>
					),
				},
				{
					value: RewardMethods.VOTE,
					label: (
						<Text fw={600} px={5}>
							{i18n._("Voter earnings")}
						</Text>
					),
				},
			]}
		/>
	);
};
