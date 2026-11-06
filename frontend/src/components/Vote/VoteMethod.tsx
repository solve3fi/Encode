"use client";

import { useLingui } from "@lingui/react";
import { SegmentedControl, Text } from "@mantine/core";
import { VoteMethods } from "@/stores/vote";
import { useVote, useVoteActions } from "@/stores/vote/VoteProvider";
import classes from "./VoteMethod.module.css";

export const VoteMethod: React.FC = () => {
	const { i18n } = useLingui();
	const method = useVote((state) => state.method);
	const { setMethod } = useVoteActions();

	return (
		<SegmentedControl
			color="purple.10"
			classNames={classes}
			value={method}
			size="md"
			onChange={(value) => setMethod(value as VoteMethods)}
			data={[
				{
					value: VoteMethods.ALL,
					label: (
						<Text fw={600} px={5}>
							{i18n._("All")}
						</Text>
					),
				},
			]}
		/>
	);
};
