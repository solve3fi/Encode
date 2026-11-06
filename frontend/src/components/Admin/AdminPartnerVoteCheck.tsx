import { Badge, Stack, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { PartnerSpace } from "@/configs/partnerSpaces";
import {
	getAutoVoteEnrollmentPDA,
	useVesolveProgram,
	vesolveAccount,
} from "@/hooks/useVesolveProgram";
import { formatAddress } from "@/lib/format";
import { GAUGE_STATUS_LABEL } from "@/lib/gaugeStatus";
import { lockVerdict, walletTarget } from "@/lib/partnerVoteDecision";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { CardLayout } from "../Layout/CardLayout";

type CheckedLock = {
	address: string;
	veTokenId: number;
	votingPower: number;
	enrolled: boolean;
};

/**
 * Shows, for every partner space, which veSOLV3 locks the public Auto-Vote keeper will put 100% behind the
 * partner's own gauge, and why any other lock is not. The keeper decides by lock OWNER, never by lock id: a lock is
 * the partner's when it is enrolled and its owner wallet is one of the (up to three) wallets on an active partner
 * space that records a pool and saved "auto-vote for our gauge" ON.
 */
export const AdminPartnerVoteCheck: React.FC<{
	spaces: PartnerSpace[] | null;
}> = ({ spaces }) => {
	const list = spaces ?? [];
	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					Partner auto-vote check
				</Text>
				<Text fz="sm" c="gray">
					How the keeper knows which veSOLV3 is a partner's: by the wallet that
					owns the lock. A lock is steered to the partner pool only when its
					owner is listed on an active partner space that records a pool, that
					wallet saved the signed "auto-vote for our gauge" choice, the lock is
					enrolled in Auto-Vote, and the partner gauge is active. Locks held by
					any other wallet are not steered. Claiming is never automatic: every
					claim needs the lock owner's own signature, so partners use "Claim all
					and lock" in one approval.
				</Text>
				{spaces === null ? (
					<Text fz="sm" c="dimmed">
						Load the partner spaces above (they are listed after the signed
						admin read) to run the check.
					</Text>
				) : list.length === 0 ? (
					<Text fz="sm" c="dimmed">
						No partner spaces yet.
					</Text>
				) : (
					list.map((space) => (
						<SpaceCheck key={space.slug} space={space} spaces={list} />
					))
				)}
			</Stack>
		</CardLayout>
	);
};

const SpaceCheck: React.FC<{ space: PartnerSpace; spaces: PartnerSpace[] }> = ({
	space,
	spaces,
}) => {
	const { pools } = useAdminPickers();
	const pool = space.poolAddress
		? pools.find((item) => item.address === space.poolAddress)
		: undefined;
	const gaugeStatus = pool?.status ?? null;
	const gaugeLabel =
		gaugeStatus === null
			? "No gauge yet"
			: (GAUGE_STATUS_LABEL[gaugeStatus] ?? "Unknown");
	return (
		<Stack gap="xs">
			<Text fw="bold">
				{space.projectName}{" "}
				<Badge
					color={space.status === "active" ? "teal" : "gray"}
					variant="light"
				>
					{space.status}
				</Badge>
			</Text>
			<Text fz="sm">
				Partner pool:{" "}
				<b>
					{space.poolAddress
						? (pool?.label ?? formatAddress(space.poolAddress))
						: "none recorded (the keeper will not steer)"}
				</b>
				{space.poolAddress ? (
					<>
						{" "}
						· gauge: <b>{gaugeLabel}</b>
					</>
				) : null}
			</Text>
			{space.wallets.map((wallet) => (
				<WalletCheck
					key={wallet}
					wallet={wallet}
					spaces={spaces}
					gaugeStatus={gaugeStatus}
					gaugeLabel={gaugeLabel}
					poolLabelFor={(address) =>
						pools.find((item) => item.address === address)?.label ??
						formatAddress(address)
					}
				/>
			))}
		</Stack>
	);
};

const WalletCheck: React.FC<{
	wallet: string;
	spaces: PartnerSpace[];
	gaugeStatus: number | null;
	gaugeLabel: string;
	poolLabelFor: (address: string) => string;
}> = ({ wallet, spaces, gaugeStatus, gaugeLabel, poolLabelFor }) => {
	const program = useVesolveProgram();
	const preference = useQuery({
		queryKey: ["partner-check-preference", wallet],
		queryFn: async () => {
			const res = await fetch(
				`/api/partners/defaults?wallet=${encodeURIComponent(wallet)}`,
				{ cache: "no-store" },
			);
			if (!res.ok) throw new Error("Could not read the saved choice");
			return (await res.json()) as { vote: boolean; saved: boolean };
		},
	});
	const locks = useQuery({
		queryKey: ["partner-check-locks", wallet],
		queryFn: async (): Promise<CheckedLock[]> => {
			const found = await vesolveAccount
				.lock(program)
				.all([{ memcmp: { offset: 8, bytes: wallet } }]);
			const enrollments = await vesolveAccount
				.autoVoteEnrollment(program)
				.fetchMultiple(
					found.map((item) => getAutoVoteEnrollmentPDA(item.publicKey)[0]),
				);
			return found.map((item, index) => ({
				address: item.publicKey.toBase58(),
				veTokenId: item.account.veTokenId.toNumber(),
				votingPower: Number(item.account.votingPower.toString()) / 1e9,
				enrolled: Boolean(enrollments[index]),
			}));
		},
	});

	const saved = preference.data ?? { saved: false, vote: false };
	const target = walletTarget(spaces, wallet, saved);

	return (
		<Stack gap={4}>
			<Text fz="sm">
				Wallet <b>{formatAddress(wallet, 6)}</b>:{" "}
				{preference.isLoading
					? "checking the saved choice…"
					: preference.error
						? "saved choice unavailable"
						: saved.saved && saved.vote
							? "auto-vote for our gauge is ON"
							: "auto-vote for our gauge is off"}
				{"pool" in target ? (
					<>
						{" "}
						· steered to <b>{poolLabelFor(target.pool)}</b>
					</>
				) : (
					<> · {target.reason}</>
				)}
			</Text>
			{locks.isLoading ? (
				<Text fz="xs" c="dimmed">
					Reading locks…
				</Text>
			) : locks.error ? (
				<Text fz="xs" c="red">
					Locks could not be read.
				</Text>
			) : (locks.data ?? []).length === 0 ? (
				<Text fz="xs" c="dimmed">
					This wallet owns no veSOLV3 locks, so there is nothing to vote.
				</Text>
			) : (
				<Table.ScrollContainer minWidth={520}>
					<Table verticalSpacing={4} fz="xs">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>veSOLV3 #</Table.Th>
								<Table.Th>Voting power</Table.Th>
								<Table.Th>Enrolled</Table.Th>
								<Table.Th>Keeper will</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{(locks.data ?? []).map((lock) => {
								const verdict = lockVerdict({
									target,
									enrolled: lock.enrolled,
									votingPower: lock.votingPower,
									gaugeStatus,
									gaugeLabel,
								});
								return (
									<Table.Tr key={lock.address}>
										<Table.Td>{lock.veTokenId}</Table.Td>
										<Table.Td>
											{lock.votingPower.toLocaleString("en-US", {
												maximumFractionDigits: 2,
											})}
										</Table.Td>
										<Table.Td>{lock.enrolled ? "Yes" : "No"}</Table.Td>
										<Table.Td>
											{verdict.kind === "partner-gauge" ? (
												<Badge color="teal" variant="light">
													Vote 100% for {poolLabelFor(verdict.pool)}
												</Badge>
											) : (
												<Text fz="xs" c="dimmed">
													{verdict.reason}
												</Text>
											)}
										</Table.Td>
									</Table.Tr>
								);
							})}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			)}
		</Stack>
	);
};
