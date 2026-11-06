import { useLingui } from "@lingui/react";
import {
	ActionIcon,
	Avatar,
	Badge,
	Group,
	ScrollArea,
	Stack,
	Text,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { VoteState } from "@/stores/vote";
import { useVote, useVoteActions } from "@/stores/vote/VoteProvider";

export const VoteItem: React.FC<{
	vote: VoteState;
}> = ({ vote }) => {
	const { removeVoteState } = useVoteActions();
	return (
		<Badge size="xl" radius="sm" color="gray.18" variant="filled" py={30}>
			<Group gap={5}>
				<Avatar.Group>
					<Avatar
						key={vote.tokenAInfo.name}
						src={vote.tokenAInfo.logoURI}
						title={vote.tokenAInfo.name}
						size={24}
					/>
					<Avatar
						key={vote.tokenBInfo.name}
						src={vote.tokenBInfo.logoURI}
						title={vote.tokenBInfo.name}
						size={24}
					/>
				</Avatar.Group>
				<Text fw="bold">
					{`${vote.tokenAInfo.symbol}/${vote.tokenBInfo.symbol}`}
				</Text>
				<Badge size="lg" px={5} radius="sm" color="gray.19" variant="filled" ml={10}>
					{vote.votePercent}%
				</Badge>
				<ActionIcon
					radius="xl"
					color="gray.17"
					size="lg"
					ml={5}
					onClick={() => removeVoteState(vote.getAddress().toString())}
				>
					<IconX width={18} height={18} />
				</ActionIcon>
			</Group>
		</Badge>
	);
};

export const VoteMyLists: React.FC = () => {
	const { i18n } = useLingui();
	const voteState = useVote((state) => state.voteState);
	return voteState.length ? (
		<Stack>
			<Text fw="bold" fz="lg">
				{i18n._("Your Votes")}
			</Text>
			<ScrollArea scrollbars="x">
				<Group>
					{voteState.map((vote) => (
						<VoteItem key={vote.getAddress().toString()} vote={vote} />
					))}
				</Group>
			</ScrollArea>
		</Stack>
	) : null;
};
