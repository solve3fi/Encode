import { useLingui } from "@lingui/react";
import { Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { useLockStats } from "@/stores/admin/hooks/useLockStats";
import { CardLayout } from "../Layout/CardLayout";
import { TokenBalance } from "../Token/TokenBalance";

export const AdminLockStats: React.FC = () => {
	const { i18n } = useLingui();
	const { data, isLoading } = useLockStats();

	const totalLocked = data?.totalLocked ?? 0;
	const usedToVote = data?.usedToVote ?? 0;
	const unusedLocked = Math.max(totalLocked - usedToVote, 0);
	const votedShare = totalLocked > 0 ? (usedToVote / totalLocked) * 100 : 0;

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("veSOLV3 Lock Stats")}
				</Text>
				<SimpleGrid cols={{ base: 1, sm: 3 }}>
					<Stack gap={0}>
						<Text c="gray.8" fz="sm">
							{i18n._("Total Locked Positions")}
						</Text>
						<Text fw="bold" fz="xl">
							<TokenBalance value={totalLocked} loading={isLoading} prefix="" />
						</Text>
					</Stack>
					<Stack gap={0}>
						<Text c="gray.8" fz="sm">
							{i18n._("Used to Vote")}
						</Text>
						<Group gap={6} align="baseline">
							<Text fw="bold" fz="xl">
								<TokenBalance
									value={usedToVote}
									loading={isLoading}
									prefix=""
								/>
							</Text>
							<Text c="gray.8" fz="xs">
								<TokenBalance
									value={votedShare}
									loading={isLoading}
									prefix="("
									suffix="%)"
									decimalScale={1}
									fixedDecimalScale
								/>
							</Text>
						</Group>
					</Stack>
					<Stack gap={0}>
						<Text c="gray.8" fz="sm">
							{i18n._("Never Voted")}
						</Text>
						<Text fw="bold" fz="xl">
							<TokenBalance
								value={unusedLocked}
								loading={isLoading}
								prefix=""
							/>
						</Text>
					</Stack>
				</SimpleGrid>
				<Text c="gray" fz="xs">
					{i18n._(
						'"Used to vote" counts locks that have cast at least one vote (Lock.last_vote_epoch != 0), not only the current epoch.',
					)}
				</Text>
			</Stack>
		</CardLayout>
	);
};
