"use client";

import { useLingui } from "@lingui/react";
import { Anchor, Avatar, Badge, Button, Group, Stack, Table, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "@/components/Notifications";
import type { TokenRequest, TokenRequestsById } from "@/configs/tokenRequests";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { formatAddress } from "@/lib/format";
import { CardLayout } from "../Layout/CardLayout";

const STATUS_COLOR: Record<TokenRequest["status"], string> = {
	pending: "yellow",
	approved: "teal",
	rejected: "red",
};

export const AdminTokenRequests: React.FC = () => {
	const { i18n } = useLingui();
	const { sign } = useAdminAuth();
	const queryClient = useQueryClient();

	const requestsQuery = useQuery({
		queryKey: ["admin-token-requests"],
		queryFn: async () => {
			const res = await fetch("/api/admin/token-requests");
			if (!res.ok) throw new Error("Failed to load");
			return res.json() as Promise<TokenRequestsById>;
		},
	});

	const reviewMutation = useMutation({
		mutationFn: async ({
			mint,
			decision,
		}: {
			mint: string;
			decision: "approved" | "rejected";
		}) => {
			const { wallet, message, signature } = await sign(
				"review token request",
				{ mint, decision },
			);
			const res = await fetch("/api/admin/token-requests", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, message, signature, mint, decision }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Review failed");
			return data as TokenRequest;
		},
		onSuccess: (record) => {
			queryClient.setQueryData<TokenRequestsById>(["admin-token-requests"], (prev) => ({
				...prev,
				[record.mint]: record,
			}));
			queryClient.invalidateQueries({ queryKey: ["token-list-extra"] });
			notification.success({
				title: i18n._("Token Requests"),
				message: i18n._("Request {status}", { status: record.status }),
			});
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Token Requests"), message: error.message });
		},
	});

	const records = Object.values(requestsQuery.data ?? {}).sort(
		(a, b) => b.submittedAt - a.submittedAt,
	);

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Token Listing Requests")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Projects requesting their token show up branded (logo, website, X) across the app. Approving publishes the token into the live token list immediately.",
					)}
				</Text>
				<Table.ScrollContainer minWidth={900}>
					<Table verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>{i18n._("Token")}</Table.Th>
								<Table.Th>{i18n._("Mint")}</Table.Th>
								<Table.Th>{i18n._("Links")}</Table.Th>
								<Table.Th>{i18n._("Submitted By")}</Table.Th>
								<Table.Th>{i18n._("Submitted")}</Table.Th>
								<Table.Th>{i18n._("Status")}</Table.Th>
								<Table.Th>{i18n._("Actions")}</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{records.length === 0 && (
								<Table.Tr>
									<Table.Td colSpan={7}>
										<Text c="gray" ta="center" py="md">
											{requestsQuery.isLoading
												? i18n._("Loading…")
												: i18n._("No token requests yet")}
										</Text>
									</Table.Td>
								</Table.Tr>
							)}
							{records.map((record) => (
								<Table.Tr key={record.mint}>
									<Table.Td>
										<Group gap="sm">
											<Avatar src={`/api/token-logos/${record.logoFile}`} size={32} radius="md" />
											<Stack gap={0}>
												<Text fw="bold">{record.symbol}</Text>
												<Text fz="xs" c="gray">
													{record.name}
												</Text>
											</Stack>
										</Group>
									</Table.Td>
									<Table.Td>
										<Text ff="monospace" fz="xs">
											{formatAddress(record.mint)}
										</Text>
									</Table.Td>
									<Table.Td>
										<Stack gap={2}>
											{record.website && (
												<Anchor href={record.website} target="_blank" fz="xs">
													{i18n._("Website")}
												</Anchor>
											)}
											{record.twitter && (
												<Anchor href={record.twitter} target="_blank" fz="xs">
													{i18n._("X")}
												</Anchor>
											)}
										</Stack>
									</Table.Td>
									<Table.Td>
										<Text ff="monospace" fz="xs">
											{formatAddress(record.submittedBy)}
										</Text>
									</Table.Td>
									<Table.Td>
										<Text fz="xs" c="gray">
											{new Date(record.submittedAt).toLocaleDateString()}
										</Text>
									</Table.Td>
									<Table.Td>
										<Badge color={STATUS_COLOR[record.status]} variant="light">
											{record.status}
										</Badge>
									</Table.Td>
									<Table.Td>
										<Group gap="xs">
											<Button
												size="xs"
												variant="light"
												color="teal"
												disabled={record.status === "approved"}
												loading={
													reviewMutation.isPending &&
													reviewMutation.variables?.mint === record.mint &&
													reviewMutation.variables?.decision === "approved"
												}
												onClick={() =>
													reviewMutation.mutate({ mint: record.mint, decision: "approved" })
												}
											>
												{i18n._("Approve")}
											</Button>
											<Button
												size="xs"
												variant="light"
												color="red"
												disabled={record.status === "rejected"}
												loading={
													reviewMutation.isPending &&
													reviewMutation.variables?.mint === record.mint &&
													reviewMutation.variables?.decision === "rejected"
												}
												onClick={() =>
													reviewMutation.mutate({ mint: record.mint, decision: "rejected" })
												}
											>
												{i18n._("Reject")}
											</Button>
										</Group>
									</Table.Td>
								</Table.Tr>
							))}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			</Stack>
		</CardLayout>
	);
};
