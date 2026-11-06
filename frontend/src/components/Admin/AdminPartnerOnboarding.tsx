"use client";

import { Alert, Badge, Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
	PARTNER_SPACE_UPDATE_ACTION,
	PARTNER_SPACES_READ_ACTION,
	type PartnerSpace,
	partnerSpaceUpdatePayload,
} from "@/configs/partnerSpaces";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { type OnboardingRow, usePartnerOnboarding } from "@/hooks/usePartnerOnboarding";
import { formatAddress } from "@/lib/format";
import type { OnboardingTarget } from "@/lib/partnerOnboarding";
import { CardLayout } from "../Layout/CardLayout";

const linkFor = (slug: string) =>
	`${typeof window === "undefined" ? "" : window.location.origin}/partner/${slug}`;

/**
 * The partner onboarding checklist: every token listing request, how far along it is, and the one
 * thing you owe it next. Links are loaded with one signature, then copied from here.
 */
export const AdminPartnerOnboarding: React.FC<{
	onNavigate: (tab: Exclude<OnboardingTarget, null>, query?: string) => void;
}> = ({ onNavigate }) => {
	const { sign } = useAdminAuth();
	const { rows, actionCount, isLoading, error, refetch } = usePartnerOnboarding();
	const [links, setLinks] = useState<Record<string, PartnerSpace> | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);

	const call = useMutation({
		mutationFn: async (input: { action: "list" } | { action: "update"; fields: Record<string, unknown> }) => {
			const fields = input.action === "update" ? input.fields : {};
			const [name, payload] =
				input.action === "list"
					? [PARTNER_SPACES_READ_ACTION, {}]
					: [PARTNER_SPACE_UPDATE_ACTION, partnerSpaceUpdatePayload(fields)];
			const auth = await sign(name, payload);
			const res = await fetch("/api/admin/partner-spaces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...auth, action: input.action, ...fields }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Request failed");
			return data as { spaces: PartnerSpace[] };
		},
		onSuccess: (data) => {
			setLinks(Object.fromEntries(data.spaces.filter((s) => s.status === "active").map((s) => [s.mint, s])));
			setMessage(null);
			refetch();
		},
		onError: (error: Error) => setMessage(error.message),
	});

	const copy = (row: OnboardingRow) => {
		const space = links?.[row.mint];
		if (!space) return;
		void navigator.clipboard.writeText(linkFor(space.slug)).then(() => {
			setCopied(row.mint);
			window.setTimeout(() => setCopied(null), 1500);
		});
	};

	return (
		<Stack gap="lg">
			<CardLayout>
				<Stack gap="md">
					<Group justify="space-between" align="flex-start">
						<div>
							<Title order={3}>Partner onboarding</Title>
							<Text fz="sm" c="dimmed">
								Every token listing request and what you still owe it. Applications from /partners are in Partner applications.
							</Text>
						</div>
						<Group gap="xs">
							<Button variant="default" onClick={refetch}>
								Refresh
							</Button>
							<Button loading={call.isPending && call.variables?.action === "list"} onClick={() => call.mutate({ action: "list" })}>
								{links ? "Reload links" : "Load links (sign)"}
							</Button>
						</Group>
					</Group>
					{actionCount > 0 ? (
						<Alert color="yellow" title={`${actionCount} ${actionCount === 1 ? "partner needs" : "partners need"} you`}>
							Work through the rows marked below. A partner is finished only after you have sent them their link.
						</Alert>
					) : (
						!isLoading && <Text c="teal">Nothing is waiting on you.</Text>
					)}
					{message && <Text c="red" fz="sm">{message}</Text>}
					{error && <Text c="red" fz="sm">{(error as Error).message}</Text>}
					{!isLoading && rows.length === 0 && <Text c="dimmed">No token listing requests yet.</Text>}
					{rows.length > 0 && (
						<Table.ScrollContainer minWidth={820}>
							<Table verticalSpacing="sm">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>Partner</Table.Th>
										<Table.Th>Progress</Table.Th>
										<Table.Th>Next step</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{rows.map((row) => {
										const { progress } = row;
										const space = links?.[row.mint];
										return (
											<Table.Tr key={row.mint}>
												<Table.Td>
													<Text fw={600}>{row.symbol}</Text>
													<Text fz="xs" c="dimmed">
														{row.name} · {formatAddress(row.mint)}
													</Text>
													{row.poolLabel && <Text fz="xs">{row.poolLabel}</Text>}
												</Table.Td>
												<Table.Td>
													<Group gap={6}>
														{progress.steps.map((step) => (
															<Badge key={step.key} variant={step.done ? "filled" : "outline"} color={step.done ? "teal" : "gray"} size="sm">
																{step.done ? "✓ " : ""}
																{step.label}
															</Badge>
														))}
													</Group>
													{progress.gaugeActive && (
														<Text fz="xs" c="teal" mt={4}>
															Gauge is active
														</Text>
													)}
												</Table.Td>
												<Table.Td>
													{progress.state === "done" && <Text c="teal">Done: link sent</Text>}
													{progress.state === "rejected" && <Text c="dimmed">Request rejected</Text>}
													{progress.state === "revoked" && <Text c="dimmed">Partner space revoked</Text>}
													{progress.next && (
														<Stack gap={6}>
															<Text fz="sm" fw={progress.next.needsAction ? 700 : 400} c={progress.next.needsAction ? undefined : "dimmed"}>
																{progress.next.text}
															</Text>
															<Group gap="xs">
																{progress.next.target && progress.next.button && (
																	<Button
																		size="xs"
																		onClick={() =>
																			onNavigate(
																				progress.next?.target as Exclude<OnboardingTarget, null>,
																				progress.next?.target === "partner-spaces" && progress.next.key === "space"
																					? `mint=${row.mint}`
																					: undefined,
																			)
																		}
																	>
																		{progress.next.button}
																	</Button>
																)}
																{progress.next.key === "link" && (
																	<>
																		<Button size="xs" variant="light" disabled={!space} onClick={() => copy(row)}>
																			{copied === row.mint ? "Copied" : space ? "Copy link" : "Load links first"}
																		</Button>
																		<Button
																			size="xs"
																			variant="default"
																			disabled={!space}
																			loading={call.isPending && call.variables?.action === "update"}
																			onClick={() =>
																				space && call.mutate({ action: "update", fields: { slug: space.slug, linkSent: true } })
																			}
																		>
																			I sent it
																		</Button>
																	</>
																)}
															</Group>
														</Stack>
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
			</CardLayout>
		</Stack>
	);
};
