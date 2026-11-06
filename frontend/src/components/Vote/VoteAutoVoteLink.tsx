"use client";

import { useLingui } from "@lingui/react";
import { Button } from "@mantine/core";
import { IconRobot } from "@tabler/icons-react";
import Link from "next/link";
import { useAutoVoteEnrollment } from "@/stores/lock/hooks/useAutoVoteEnrollment";
import { useLockData } from "@/stores/lock/hooks/useLockData";
import { useVote } from "@/stores/vote/VoteProvider";

/** Opens Auto-Vote for the lock selected on the Vote page (or the Lock page when no lock is selected yet). */
export const VoteAutoVoteLink: React.FC = () => {
	const { i18n } = useLingui();
	const lockId = useVote((state) => state.lockId);
	const { data: lock } = useLockData(lockId);
	const { data: enrollment } = useAutoVoteEnrollment(lock?.address);
	// lockId defaults to 0, so only link to a lock that actually exists.
	const href = lock ? `/lock/auto-vote?lockId=${lockId}` : "/lock";
	return (
		<Button
			size="lg"
			component={Link}
			href={href}
			leftSection={<IconRobot size={20} />}
		>
			{enrollment ? i18n._("Auto-Vote: On") : i18n._("Auto-Vote")}
		</Button>
	);
};
