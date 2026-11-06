import { useLingui } from "@lingui/react";
import { Stack, Text } from "@mantine/core";
import Decimal from "decimal.js";
import type { BribeInfo, VoteInfo } from "@/stores/vote/hooks/useVotes";
import { TokenBalance } from "../Token/TokenBalance";

export const units = (raw: { toString(): string } | undefined, decimals: number) =>
	new Decimal(raw?.toString() ?? "0").div(new Decimal(10).pow(decimals)).toNumber();

export const BribesReward = ({ data }: { data: BribeInfo[] }) => (
	<Stack gap={2} align="flex-end">
		{data.length === 0 ? <Text size="xs">0</Text> : data.map((item, index) => (
			<Text size="xs" key={item.mint.toBase58() + index}>
				{units(item.vaultInfo.amount, item.mintInfo.decimals).toLocaleString("en-US", { maximumFractionDigits: 9 })} {item.mintInfo.symbol}
			</Text>
		))}
	</Stack>
);

// Bribes and Trading Fees each show their own per-token breakdown as their
// own column now (see VoteLists.tsx/VoteListsMobile.tsx), so this is just
// their sum -- nothing left to hide behind a click.
export const VoteReward = ({ poolVote }: { poolVote: VoteInfo }) => {
	const { i18n } = useLingui();
	return (
		<Stack gap={2} align="flex-end">
			<Text fw="bold">
				{poolVote.rewardsUsd > 0 ? (
					<TokenBalance value={poolVote.rewardsUsd} loading={false} prefix="$" />
				) : (
					"—"
				)}
			</Text>
			<Text size="xs" c="gray.7">
				{i18n._("Fees + Incentives")}
			</Text>
		</Stack>
	);
};
