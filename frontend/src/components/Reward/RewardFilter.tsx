import { useLingui } from "@lingui/react";
import { CloseButton, Input } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useReward, useRewardActions } from "@/stores/reward/RewardProvider";
import classes from "./RewardFilter.module.css";

export const RewardFilter: React.FC = () => {
	const { i18n } = useLingui();
	const filter = useReward((state) => state.filter);
	const { setFilter } = useRewardActions();
	return (
		<Input
			variant="filled"
			placeholder={i18n._("Search")}
			size="md"
			classNames={classes}
			value={filter}
			onChange={(event) => setFilter(event.currentTarget.value)}
			leftSection={
				<IconSearch size={20} color="var(--mantine-color-purple-8)" />
			}
			rightSection={
				filter ? (
					<CloseButton
						size="sm"
						onClick={() => setFilter("")}
						aria-label={i18n._("Clear search")}
					/>
				) : null
			}
		/>
	);
};
