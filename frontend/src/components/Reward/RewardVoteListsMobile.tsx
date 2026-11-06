import { useLingui } from "@lingui/react";
import {
	Avatar,
	Button,
	Divider,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import type { PublicKey } from "@solana/web3.js";
import { useAllTokens } from "@/hooks/useToken";
import type { ClaimableVoteReward } from "@/hooks/useVoteRewards";
import { formatTokenAmount } from "@/lib/format";
import { CurrencyLogo } from "../Token/CurrencyLogo";
import { toNumber } from "./RewardVoteLists";

// The desktop DataTable's columns add up to ~726px -- wider than any phone,
// and the Claim control is the rightmost one, so on a 390px screen it sits
// ~330px past the right edge of a ScrollArea whose scrollbar never shows on
// touch. This mirrors the same row data as cards instead, the same way
// VoteListsMobile does for the Vote page's gauge table, so the claim stays
// reachable without horizontal scrolling.
export const RewardVoteListsMobile: React.FC<{
	records: ClaimableVoteReward[];
	publicKey: PublicKey | null;
	onClaim: (record: ClaimableVoteReward) => void;
	pendingKey?: string;
}> = ({ records, publicKey, onClaim, pendingKey }) => {
	const { i18n } = useLingui();
	const tokenMap = useAllTokens();

	return (
		<SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="xs">
			{records.map((record) => {
				const currencyA = tokenMap[record.tokenMintA.toString()];
				const currencyB = tokenMap[record.tokenMintB.toString()];
				const rewardToken = tokenMap[record.rewardMint.toString()];
				const hasFees =
					record.poolRewardAmountA.gtn(0) || record.poolRewardAmountB.gtn(0);

				return (
					<Paper key={record.key} p="sm" radius="md" withBorder>
						<Stack gap={6}>
							<Group gap={8}>
								<Avatar.Group>
									<CurrencyLogo currency={currencyA} size={26} />
									<CurrencyLogo currency={currencyB} size={26} />
								</Avatar.Group>
								<Stack gap={0}>
									<Text fw="bold" size="sm">
										{`${currencyA?.symbol ?? "?"}/${currencyB?.symbol ?? "?"}`}
									</Text>
									<Text size="xs" c="gray">
										{i18n._("Epoch {epoch}", { epoch: record.epoch })}
									</Text>
								</Stack>
							</Group>

							<Divider />

							<Group justify="space-between" align="flex-start">
								<Text size="xs" c="gray">
									{i18n._("Voting Emission")}
								</Text>
								{record.rewardAmount.gtn(0) ? (
									<Text fw="bold" size="sm">
										{formatTokenAmount(
											toNumber(record.rewardAmount, rewardToken?.decimals ?? 9),
											{ decimals: 4 },
										)}{" "}
										{rewardToken?.symbol ?? "SOLV3"}
									</Text>
								) : (
									<Text c="gray">—</Text>
								)}
							</Group>

							<Group justify="space-between" align="flex-start">
								<Text size="xs" c="gray">
									{i18n._("Swept Trading Fees")}
								</Text>
								{hasFees ? (
									<Stack gap={0} align="flex-end">
										{record.poolRewardAmountA.gtn(0) && (
											<Text size="xs" fw={600}>
												{formatTokenAmount(
													toNumber(
														record.poolRewardAmountA,
														currencyA?.decimals ?? 9,
													),
													{ decimals: 4 },
												)}{" "}
												{currencyA?.symbol}
											</Text>
										)}
										{record.poolRewardAmountB.gtn(0) && (
											<Text size="xs" fw={600}>
												{formatTokenAmount(
													toNumber(
														record.poolRewardAmountB,
														currencyB?.decimals ?? 9,
													),
													{ decimals: 4 },
												)}{" "}
												{currencyB?.symbol}
											</Text>
										)}
									</Stack>
								) : (
									<Text c="gray">—</Text>
								)}
							</Group>

							<Group justify="space-between" align="flex-start">
								<Text size="xs" c="gray">
									{i18n._("Bribes")}
								</Text>
								{record.bribes.length === 0 ? (
									<Text c="gray">—</Text>
								) : (
									<Stack gap={0} align="flex-end">
										{record.bribes.map((bribe) => {
											const token = tokenMap[bribe.mint.toString()];
											return (
												<Text size="xs" fw={600} key={bribe.mint.toString()}>
													{formatTokenAmount(
														toNumber(bribe.amount, token?.decimals ?? 9),
														{ decimals: 4 },
													)}{" "}
													{token?.symbol ?? "?"}
												</Text>
											);
										})}
									</Stack>
								)}
							</Group>

							{record.autoVoteFeeBps > 0 && (
								<Text size="xs" c="dimmed">
									{i18n._("Fees and bribes shown after the {pct}% Auto-Vote fee", {
										pct: record.autoVoteFeeBps / 100,
									})}
								</Text>
							)}
							<Button
								fullWidth
								variant="filled"
								disabled={!publicKey}
								loading={pendingKey === record.key}
								onClick={() => onClaim(record)}
							>
								{i18n._("Claim")}
							</Button>
						</Stack>
					</Paper>
				);
			})}
		</SimpleGrid>
	);
};
