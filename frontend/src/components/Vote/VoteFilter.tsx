import { useLingui } from "@lingui/react";
import { CloseButton, Input } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useVote, useVoteActions } from "@/stores/vote/VoteProvider";
import classes from "./VoteFilter.module.css";

export const VoteFilter: React.FC = () => {
	const { i18n } = useLingui();
	const searchQuery = useVote((state) => state.searchQuery);
	const { setSearchQuery } = useVoteActions();
	return (
		<Input
			variant="filled"
			placeholder={i18n._("Search Pools")}
			size="md"
			classNames={classes}
			value={searchQuery}
			onChange={(event) => setSearchQuery(event.currentTarget.value)}
			leftSection={
				<IconSearch size={20} color="var(--mantine-color-purple-8)" />
			}
			rightSection={
				searchQuery ? (
					<CloseButton
						size="sm"
						onClick={() => setSearchQuery("")}
						aria-label={i18n._("Clear search")}
					/>
				) : null
			}
		/>
	);
};
