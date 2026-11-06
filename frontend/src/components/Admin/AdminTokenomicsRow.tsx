"use client";

import { Group, Table, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import type { TokenomicsCategory } from "@/configs/tokenomics";
import { useWalletHoldings } from "@/stores/admin/hooks/useWalletHoldings";

export type AdminTokenomicsRowProps = {
	category: TokenomicsCategory;
	assignedWallet: string | undefined;
	onSave: (category: string, address: string) => void;
	saving: boolean;
};

export const AdminTokenomicsRow: React.FC<AdminTokenomicsRowProps> = ({
	category,
	assignedWallet,
	onSave,
	saving,
}) => {
	const [input, setInput] = useState(assignedWallet ?? "");
	useEffect(() => setInput(assignedWallet ?? ""), [assignedWallet]);

	const { data: holdings, isLoading } = useWalletHoldings(assignedWallet);
	const dirty = input.trim() !== (assignedWallet ?? "");

	return (
		<Table.Tr>
			<Table.Td fw={600}>{category.name}</Table.Td>
			<Table.Td data-numeric="true">
				{formatTokenAmount(category.amount)} {category.locked ? "veSOLV3" : "SOLV3"}
			</Table.Td>
			<Table.Td data-numeric="true">{category.percent}%</Table.Td>
			<Table.Td miw={260}>
				<TextInput
					placeholder="Wallet address"
					value={input}
					onChange={(event) => setInput(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && dirty) onSave(category.key, input.trim());
					}}
					rightSection={
						dirty && (
							<Text
								fz="xs"
								c="purple.5"
								fw="bold"
								style={{ cursor: saving ? "default" : "pointer" }}
								onClick={() => !saving && onSave(category.key, input.trim())}
							>
								{saving ? "…" : "Save"}
							</Text>
						)
					}
					rightSectionWidth={50}
				/>
			</Table.Td>
			<Table.Td data-numeric="true">
				{!assignedWallet ? (
					<Text c="gray" fz="sm">
						—
					</Text>
				) : isLoading ? (
					<Text c="gray" fz="sm">
						…
					</Text>
				) : (
					<Group gap={4}>
						<Text fz="sm">{formatTokenAmount(holdings?.solv3Balance ?? 0)} SOLV3</Text>
						<Text c="gray" fz="xs">
							+ {formatTokenAmount(holdings?.totalLockedAmount ?? 0)} veSOLV3
						</Text>
					</Group>
				)}
			</Table.Td>
		</Table.Tr>
	);
};
