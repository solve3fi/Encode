import { useLingui } from "@lingui/react";
import { Group, Stack, Title } from "@mantine/core";
import { type ClaimInfo, ClaimTable } from "./ClaimTable";

const data: ClaimInfo[] = [
	{
		tokenInfo: { name: "SOLV3", logoImg: "/assets/tokens/solv3.png" },
		lockID: "2735",
		unlockDate: "January 15, 2025",
		waitingToken: 1,
		claimToken: 5,
	},
];
export const CLaimList: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<Stack gap="lg">
			<Group align="center" justify="space-between">
				<Title fs="xl">{i18n._("Claim zero fee rewards")}</Title>
			</Group>

			<ClaimTable claims={data} />
		</Stack>
	);
};
