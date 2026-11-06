import { Badge, Button, Group, Stack, Table, Text } from "@mantine/core";
import { PublicKey } from "@solana/web3.js";
import { useMemo } from "react";
import { useTokens } from "@/hooks/useToken";
import { formatAddress, formatTokenAmount } from "@/lib/format";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { useGaugelessPools } from "@/stores/admin/hooks/useGaugelessPools";
import { useAdminConfig } from "@/stores/admin/hooks/useProtocolControls";
import {
	BRIBE_LOOKBACK_EPOCHS,
	useBribeLedger,
	useSweepUnvotedBribe,
} from "@/stores/admin/hooks/useUnvotedBribes";
import { CardLayout } from "../Layout/CardLayout";

/**
 * Bribes cannot be refunded to the wallet that made them. This panel shows every recent bribe and what can still
 * happen to it: after an epoch ends, a bribe on a gauge nobody voted for can be swept to the Treasury, from where
 * the Treasury can bribe the right gauge; a bribe on a gauge that did get votes belongs to its voters.
 */
export function AdminBribeRecovery() {
	const ledger = useBribeLedger();
	const { gauges } = useGaugelessPools();
	const { pools } = useAdminPickers();
	const config = useAdminConfig();
	const sweep = useSweepUnvotedBribe();
	const treasury = config.data?.treasury ?? null;
	const rows = ledger.data ?? [];

	const mints = useMemo(() => rows.map((row) => row.mint.toBase58()), [rows]);
	const tokens = useTokens(mints);

	const poolLabel = (gauge: PublicKey) => {
		const poolAddress = gauges
			.find((item) => item.publicKey.equals(gauge))
			?.account.poolAddress.toBase58();
		const pool = pools.find((item) => item.address === poolAddress);
		return pool?.label ?? formatAddress(poolAddress ?? gauge.toBase58());
	};

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					Bribe recovery
				</Text>
				<Text fz="sm" c="gray">
					A bribe cannot be refunded to the wallet that made it. When an epoch
					ends, a bribe on a gauge that nobody voted for can be swept to the
					Treasury; the Treasury can then bribe the right gauge. A bribe on a
					gauge that did get votes belongs to those voters. Showing the last{" "}
					{BRIBE_LOOKBACK_EPOCHS} epochs.
				</Text>
				<Text fz="sm">
					Treasury:{" "}
					{treasury ? <b>{formatAddress(treasury, 6)}</b> : <b>not set</b>}
					{!treasury ? " (set it in Controls before sweeping)" : null}
				</Text>
				{ledger.error ? (
					<Text c="red" size="sm">
						Bribes could not be read. Refresh before acting.
					</Text>
				) : null}
				{!ledger.isLoading && rows.length === 0 && !ledger.error ? (
					<Text fz="sm" c="dimmed">
						No bribes recorded in these epochs.
					</Text>
				) : null}
				{rows.length > 0 ? (
					<Table.ScrollContainer minWidth={640}>
						<Table verticalSpacing="xs" fz="sm">
							<Table.Thead>
								<Table.Tr>
									<Table.Th>Epoch</Table.Th>
									<Table.Th>Pool</Table.Th>
									<Table.Th>Bribe</Table.Th>
									<Table.Th>Status</Table.Th>
									<Table.Th />
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{rows.map((row, index) => {
									const token = tokens?.[index];
									const amount =
										Number(row.amount.toString()) /
										10 ** (token?.decimals ?? 9);
									const sweepable = row.ended && !row.hasVotes;
									const busy =
										sweep.isPending &&
										sweep.variables?.epoch === row.epoch &&
										sweep.variables.gauge.equals(row.gauge) &&
										sweep.variables.mint.equals(row.mint);
									return (
										<Table.Tr
											key={`${row.epoch}-${row.gauge.toBase58()}-${row.mint.toBase58()}`}
										>
											<Table.Td>{row.epoch}</Table.Td>
											<Table.Td>{poolLabel(row.gauge)}</Table.Td>
											<Table.Td>
												{formatTokenAmount(amount, { decimals: 4 })}{" "}
												{token?.symbol ?? formatAddress(row.mint.toBase58())}
											</Table.Td>
											<Table.Td>
												{!row.ended ? (
													<Badge color="yellow" variant="light">
														Epoch running
													</Badge>
												) : row.hasVotes ? (
													<Badge color="gray" variant="light">
														Has votes: pays its voters
													</Badge>
												) : (
													<Badge color="teal" variant="light">
														Unvoted: can go to Treasury
													</Badge>
												)}
											</Table.Td>
											<Table.Td>
												{sweepable ? (
													<Button
														size="xs"
														disabled={!treasury || sweep.isPending}
														loading={busy}
														onClick={() =>
															treasury &&
															sweep.mutate({
																epoch: row.epoch,
																gauge: row.gauge,
																mint: row.mint,
																treasury: new PublicKey(treasury),
															})
														}
													>
														Send to Treasury
													</Button>
												) : null}
											</Table.Td>
										</Table.Tr>
									);
								})}
							</Table.Tbody>
						</Table>
					</Table.ScrollContainer>
				) : null}
				<Group>
					<Text fz="xs" c="dimmed">
						To move a bribe to another pool: wait for the epoch to end with no
						votes on the old gauge, send it to the Treasury here, then bribe the
						new gauge from the Treasury wallet on the Add bribe page.
					</Text>
				</Group>
			</Stack>
		</CardLayout>
	);
}
