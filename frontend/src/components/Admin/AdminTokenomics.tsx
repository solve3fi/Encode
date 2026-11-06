"use client";

import { useLingui } from "@lingui/react";
import { Stack, Table, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import { TOKENOMICS_CATEGORIES, TOTAL_SUPPLY } from "@/configs/tokenomics";
import { formatTokenAmount } from "@/lib/format";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { CardLayout } from "../Layout/CardLayout";
import { AdminTokenomicsRow } from "./AdminTokenomicsRow";

type TokenomicsWallets = Record<string, string>;

export const AdminTokenomics: React.FC = () => {
	const { i18n } = useLingui();
	const { sign } = useAdminAuth();
	const queryClient = useQueryClient();

	const walletsQuery = useQuery({
		queryKey: ["tokenomics-wallets"],
		queryFn: async () => {
			const res = await fetch("/api/admin/tokenomics-wallets");
			if (!res.ok) throw new Error("Failed to load");
			return res.json() as Promise<TokenomicsWallets>;
		},
	});

	const saveMutation = useMutation({
		mutationFn: async ({ category, address }: { category: string; address: string }) => {
			const { wallet, message, signature } = await sign(
				"set tokenomics wallet",
				{ category, address },
			);
			const res = await fetch("/api/admin/tokenomics-wallets", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, message, signature, category, address }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Save failed");
			return data as TokenomicsWallets;
		},
		onSuccess: (data) => {
			queryClient.setQueryData(["tokenomics-wallets"], data);
			notification.success({ title: i18n._("Tokenomics"), message: i18n._("Wallet saved") });
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Tokenomics"), message: error.message });
		},
	});

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Tokenomics")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"From docs.solve3.fi/tokenomics - genesis allocation {total} SOLV3. The docs don't publish wallet addresses per category, so assign the real ones here to track live holdings against the published allocation.",
						{ total: formatTokenAmount(TOTAL_SUPPLY) },
					)}
				</Text>
				<Table.ScrollContainer minWidth={780}>
					<Table verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>{i18n._("Category")}</Table.Th>
								<Table.Th>{i18n._("Allocated")}</Table.Th>
								<Table.Th>{i18n._("% of Supply")}</Table.Th>
								<Table.Th>{i18n._("Wallet")}</Table.Th>
								<Table.Th>{i18n._("Live Holdings")}</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{TOKENOMICS_CATEGORIES.map((category) => (
								<AdminTokenomicsRow
									key={category.key}
									category={category}
									assignedWallet={walletsQuery.data?.[category.key]}
									saving={
										saveMutation.isPending &&
										saveMutation.variables?.category === category.key
									}
									onSave={(cat, address) => saveMutation.mutate({ category: cat, address })}
								/>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			</Stack>
		</CardLayout>
	);
};
