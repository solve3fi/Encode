"use client";

import { RewardProvider } from "@/stores/reward/RewardProvider";
import { RewardWrapper } from "./RewardWrapper";

export const Reward: React.FC<{ wallet?: boolean }> = ({ wallet = false }) => {
	return (
		<RewardProvider>
			<RewardWrapper wallet={wallet} />
		</RewardProvider>
	);
};
