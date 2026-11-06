"use client";

import { Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import {
	PARTNER_APPLICATIONS_READ_ACTION,
	type PartnerApplication,
} from "@/configs/partnerApplications";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { CardLayout } from "../Layout/CardLayout";

/** Pilot requests from /partners. Loading asks for a wallet signature. */
export const AdminPartnerApplications: React.FC = () => {
	const { sign } = useAdminAuth();
	const load = useMutation({
		mutationFn: async () => {
			const { wallet, message, signature } = await sign(PARTNER_APPLICATIONS_READ_ACTION);
			const res = await fetch("/api/admin/partner-applications", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, message, signature }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Failed to load");
			return data as PartnerApplication[];
		},
	});
	const rows = load.data ?? [];

	return (
		<CardLayout>
			<Stack gap="md">
				<Group justify="space-between">
					<Title order={3}>Partner applications</Title>
					<Button loading={load.isPending} onClick={() => load.mutate()}>
						{load.data ? "Reload" : "Load (sign)"}
					</Button>
				</Group>
				{load.error && <Text c="red">{(load.error as Error).message}</Text>}
				{load.data && rows.length === 0 && <Text c="dimmed">No applications yet.</Text>}
				{rows.length > 0 && (
					<Table.ScrollContainer minWidth={640}>
						<Table>
							<Table.Thead>
								<Table.Tr>
									<Table.Th>Received</Table.Th>
									<Table.Th>Project</Table.Th>
									<Table.Th>Pool</Table.Th>
									<Table.Th>Mint</Table.Th>
									<Table.Th>Contact</Table.Th>
								</Table.Tr>
							</Table.Thead>
							<Table.Tbody>
								{rows.map((row) => (
									<Table.Tr key={`${row.submittedAt}-${row.contact}`}>
										<Table.Td>{new Date(row.submittedAt).toLocaleString()}</Table.Td>
										<Table.Td>{row.project}{row.accelerator ? " (Accelerator)" : ""}</Table.Td>
										<Table.Td>{row.pair || "—"}</Table.Td>
										<Table.Td style={{ overflowWrap: "anywhere" }}>{row.mint || "—"}</Table.Td>
										<Table.Td style={{ overflowWrap: "anywhere" }}>{row.contact}</Table.Td>
									</Table.Tr>
								))}
							</Table.Tbody>
						</Table>
					</Table.ScrollContainer>
				)}
			</Stack>
		</CardLayout>
	);
};
