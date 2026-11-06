"use client";

import { useLingui } from "@lingui/react";
import {
	Badge,
	Group,
	Stack,
	Table,
	Text,
	Select,
	TextInput,
} from "@mantine/core";
import { useState } from "react";
import { formatAddress, formatTokenAmount } from "@/lib/format";
import { useLockHolders } from "@/stores/admin/hooks/useLockHolders";
import { useWalletHoldings } from "@/stores/admin/hooks/useWalletHoldings";
import { CardLayout } from "../Layout/CardLayout";

export const AdminWalletLookup: React.FC = () => {
	const { i18n } = useLingui();
	const [input, setInput] = useState("");
	const { data: holders } = useLockHolders();
	const { data, isLoading, isError } = useWalletHoldings(input.trim() || undefined);

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Wallet Lookup")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._("Paste any Solana wallet address to see its live SOLV3 and veSOLV3 holdings.")}
				</Text>
				<Select
					placeholder={i18n._("Pick a wallet that holds a lock…")}
					data={holders ?? []}
					value={(holders ?? []).some((option) => option.value === input.trim()) ? input.trim() : null}
					onChange={(value) => setInput(value ?? "")}
					searchable
					clearable
					nothingFoundMessage={i18n._("No lock holders found")}
				/>
				<TextInput
					placeholder={i18n._("Or paste any Solana wallet address")}
					value={input}
					onChange={(event) => setInput(event.currentTarget.value)}
				/>

				{input.trim() && isError && (
					<Text c="red" fz="sm">
						{i18n._("Not a valid Solana address.")}
					</Text>
				)}

				{data && (
					<Stack gap="sm">
						<Group gap="xl">
							<Stack gap={0}>
								<Text c="gray.8" fz="sm">
									{i18n._("SOLV3 (liquid)")}
								</Text>
								<Text fw="bold" fz="lg">
									{formatTokenAmount(data.solv3Balance)}
								</Text>
							</Stack>
							<Stack gap={0}>
								<Text c="gray.8" fz="sm">
									{i18n._("Total Locked (veSOLV3)")}
								</Text>
								<Text fw="bold" fz="lg">
									{formatTokenAmount(data.totalLockedAmount)}
								</Text>
							</Stack>
							<Stack gap={0}>
								<Text c="gray.8" fz="sm">
									{i18n._("Total Voting Power")}
								</Text>
								<Text fw="bold" fz="lg">
									{formatTokenAmount(data.totalVotingPower)}
								</Text>
							</Stack>
						</Group>

						{data.lockPositions.length > 0 ? (
							<Table.ScrollContainer minWidth={480}>
								<Table verticalSpacing="xs">
									<Table.Thead>
										<Table.Tr>
											<Table.Th>{i18n._("veSOLV3 ID")}</Table.Th>
											<Table.Th>{i18n._("Locked Amount")}</Table.Th>
											<Table.Th>{i18n._("Voting Power")}</Table.Th>
											<Table.Th>{i18n._("Voted")}</Table.Th>
										</Table.Tr>
									</Table.Thead>
									<Table.Tbody>
										{data.lockPositions.map((position) => (
											<Table.Tr key={position.address}>
												<Table.Td>{position.veTokenId}</Table.Td>
												<Table.Td data-numeric="true">
													{formatTokenAmount(position.amount)}
												</Table.Td>
												<Table.Td data-numeric="true">
													{formatTokenAmount(position.votingPower)}
												</Table.Td>
												<Table.Td>
													<Badge
														color={position.usedToVote ? "success.8" : "gray"}
														variant="outline"
													>
														{position.usedToVote ? i18n._("Yes") : i18n._("No")}
													</Badge>
												</Table.Td>
											</Table.Tr>
										))}
									</Table.Tbody>
								</Table>
							</Table.ScrollContainer>
						) : (
							<Text c="gray" fz="sm">
								{i18n._("No locked veSOLV3 positions for {wallet}", {
									wallet: formatAddress(input.trim()),
								})}
							</Text>
						)}
					</Stack>
				)}

				{isLoading && input.trim() && !isError && (
					<Text c="gray" fz="sm">
						{i18n._("Loading…")}
					</Text>
				)}
			</Stack>
		</CardLayout>
	);
};
