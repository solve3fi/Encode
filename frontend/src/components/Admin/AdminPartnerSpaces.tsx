"use client";

import {
	Badge,
	Button,
	Group,
	Select,
	Stack,
	Table,
	Text,
	Textarea,
	TextInput,
	Title,
} from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
	PARTNER_SPACE_CREATE_ACTION,
	PARTNER_SPACE_MAX_WALLETS,
	PARTNER_SPACE_UPDATE_ACTION,
	PARTNER_SPACES_READ_ACTION,
	type PartnerSpace,
	partnerSpaceCreatePayload,
	partnerSpaceUpdatePayload,
} from "@/configs/partnerSpaces";
import type { TokenRequestsById } from "@/configs/tokenRequests";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { formatAddress } from "@/lib/format";
import { GAUGE_STATUS, GAUGE_STATUS_LABEL } from "@/lib/gaugeStatus";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { CardLayout } from "../Layout/CardLayout";
import { AdminPartnerVoteCheck } from "./AdminPartnerVoteCheck";

const blankWallets = () => Array.from({ length: PARTNER_SPACE_MAX_WALLETS }, () => "");
const linkFor = (slug: string) =>
	`${typeof window === "undefined" ? "" : window.location.origin}/partner/${slug}`;

/**
 * Issue and manage each approved partner's private space: an unguessable link that only the (up to
 * three) wallets the partner chose can open. Everything here is a signed admin action.
 */
export const AdminPartnerSpaces: React.FC = () => {
	const { sign } = useAdminAuth();
	const { pools } = useAdminPickers();
	const [spaces, setSpaces] = useState<PartnerSpace[] | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);

	const listings = useQuery({
		queryKey: ["admin-token-requests-for-spaces"],
		queryFn: async () => {
			const res = await fetch("/api/admin/token-requests");
			if (!res.ok) throw new Error("Could not load token listings");
			return (await res.json()) as TokenRequestsById;
		},
	});
	const approved = useMemo(
		() => Object.values(listings.data ?? {}).filter((entry) => entry.status === "approved"),
		[listings.data],
	);
	const poolFor = (space: Pick<PartnerSpace, "mint" | "poolAddress">) =>
		pools.find((pool) =>
			space.poolAddress ? pool.address === space.poolAddress : pool.mintA === space.mint || pool.mintB === space.mint,
		);
	const gaugeLabel = (status: number | undefined) =>
		status === undefined ? "No gauge" : (GAUGE_STATUS_LABEL[status] ?? "Unknown");

	const call = useMutation({
		mutationFn: async (input: { action: "list" | "create" | "update"; fields?: Record<string, unknown> }) => {
			const fields = input.fields ?? {};
			const [name, payload] =
				input.action === "list"
					? [PARTNER_SPACES_READ_ACTION, {}]
					: input.action === "create"
						? [PARTNER_SPACE_CREATE_ACTION, partnerSpaceCreatePayload(fields)]
						: [PARTNER_SPACE_UPDATE_ACTION, partnerSpaceUpdatePayload(fields)];
			const auth = await sign(name, payload);
			const res = await fetch("/api/admin/partner-spaces", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...auth, action: input.action, ...fields }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Request failed");
			return data as { spaces: PartnerSpace[]; space?: PartnerSpace };
		},
		onSuccess: (data, input) => {
			setSpaces(data.spaces);
			setMessage(
				input.action === "create"
					? "Partner space created. Copy the link and send it to the partner."
					: input.action === "update"
						? "Saved."
						: null,
			);
		},
		onError: (error: Error) => setMessage(error.message),
	});

	// Create form
	const [mint, setMint] = useState<string | null>(null);
	const [projectName, setProjectName] = useState("");
	const [poolAddress, setPoolAddress] = useState<string | null>(null);
	const [wallets, setWallets] = useState<string[]>(blankWallets());
	const [note, setNote] = useState("");
	const listingOptions = approved
		.filter((entry) => !(spaces ?? []).some((s) => s.mint === entry.mint && s.status === "active"))
		.map((entry) => ({ value: entry.mint, label: `${entry.symbol} · ${entry.name}` }));
	// Arriving from the onboarding checklist: #partner-spaces?mint=<mint> preselects that listing.
	useEffect(() => {
		if (typeof window === "undefined" || mint || approved.length === 0) return;
		const wanted = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("mint");
		const entry = wanted ? approved.find((e) => e.mint === wanted) : undefined;
		if (entry) {
			setMint(entry.mint);
			setProjectName(entry.name);
		}
	}, [approved, mint]);
	const poolOptions = pools
		.filter((pool) => !mint || pool.mintA === mint || pool.mintB === mint)
		.map((pool) => ({ value: pool.address, label: `${pool.label} · ${gaugeLabel(pool.status)}` }));

	// Edit form
	const [editing, setEditing] = useState<string | null>(null);
	const [editWallets, setEditWallets] = useState<string[]>(blankWallets());
	const [editNote, setEditNote] = useState("");
	const [editPool, setEditPool] = useState<string | null>(null);
	const [editMint, setEditMint] = useState<string | null>(null);
	const editPoolOptions = pools
		.filter((pool) => !editMint || pool.mintA === editMint || pool.mintB === editMint)
		.map((pool) => ({ value: pool.address, label: `${pool.label} · ${gaugeLabel(pool.status)}` }));
	const startEdit = (space: PartnerSpace) => {
		setEditing(space.slug);
		setEditPool(space.poolAddress ?? null);
		setEditMint(space.mint);
		setEditWallets([...space.wallets, ...blankWallets()].slice(0, PARTNER_SPACE_MAX_WALLETS));
		setEditNote(space.note ?? "");
	};
	const copy = (slug: string) =>
		navigator.clipboard.writeText(linkFor(slug)).then(() => {
			setCopied(slug);
			window.setTimeout(() => setCopied(null), 1500);
		});

	const walletInputs = (values: string[], set: (next: string[]) => void) => (
		<Stack gap="xs">
			{values.map((value, index) => (
				<TextInput
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed three slots
					key={index}
					label={index === 0 ? `Partner wallets (up to ${PARTNER_SPACE_MAX_WALLETS})` : undefined}
					placeholder={index === 0 ? "Wallet address (required)" : "Optional"}
					value={value}
					onChange={(event) => set(values.map((v, i) => (i === index ? event.currentTarget.value : v)))}
				/>
			))}
		</Stack>
	);

	return (
		<Stack gap="lg">
			<CardLayout>
				<Stack gap="md">
					<Group justify="space-between">
						<Title order={3}>Partner spaces</Title>
						<Button loading={call.isPending && call.variables?.action === "list"} onClick={() => call.mutate({ action: "list" })}>
							{spaces ? "Reload" : "Load (sign)"}
						</Button>
					</Group>
					<Text fz="sm" c="dimmed">
						After a partner's token listing is approved and their gauge is added, create their private space here. The link is a secret: only the wallets you enter can open it, and
						anyone else sees nothing. Rotate the link if it leaks.
					</Text>
					{message && <Text fz="sm">{message}</Text>}
					{spaces && spaces.length === 0 && <Text c="dimmed">No partner spaces yet.</Text>}
					{spaces && spaces.length > 0 && (
						<Table.ScrollContainer minWidth={760}>
							<Table verticalSpacing="sm">
								<Table.Thead>
									<Table.Tr>
										<Table.Th>Project</Table.Th>
										<Table.Th>Gauge</Table.Th>
										<Table.Th>Wallets</Table.Th>
										<Table.Th>Status</Table.Th>
										<Table.Th>Actions</Table.Th>
									</Table.Tr>
								</Table.Thead>
								<Table.Tbody>
									{spaces.map((space) => {
										const pool = poolFor(space);
										return (
											<Table.Tr key={space.slug}>
												<Table.Td>
													<Text fw={600}>{space.projectName}</Text>
													<Text fz="xs" c="dimmed">
														{formatAddress(space.mint)}
													</Text>
												</Table.Td>
												<Table.Td>
													<Text fz="sm">{pool ? pool.label : "No pool yet"}</Text>
													<Badge
														size="sm"
														variant="light"
														color={pool?.status === GAUGE_STATUS.active ? "teal" : "yellow"}
													>
														{gaugeLabel(pool?.status)}
													</Badge>
												</Table.Td>
												<Table.Td>
													{space.wallets.map((w) => (
														<Text key={w} fz="xs" ff="monospace">
															{formatAddress(w)}
														</Text>
													))}
												</Table.Td>
												<Table.Td>
													<Badge color={space.status === "active" ? "teal" : "gray"} variant="light">
														{space.status}
													</Badge>
													{space.status === "active" && (
														<Text fz="xs" c={space.linkSentAt ? "teal" : "yellow"} mt={4}>
															{space.linkSentAt ? `Link sent ${new Date(space.linkSentAt).toLocaleDateString()}` : "Link not sent yet"}
														</Text>
													)}
												</Table.Td>
												<Table.Td>
													<Group gap="xs">
														<Button size="xs" variant="light" onClick={() => void copy(space.slug)}>
															{copied === space.slug ? "Copied" : "Copy link"}
														</Button>
														{space.status === "active" && (
															<Button
																size="xs"
																variant="default"
																onClick={() =>
																	call.mutate({ action: "update", fields: { slug: space.slug, linkSent: !space.linkSentAt } })
																}
															>
																{space.linkSentAt ? "Unmark sent" : "I sent it"}
															</Button>
														)}
														<Button size="xs" variant="default" onClick={() => startEdit(space)}>
															Edit
														</Button>
														<Button
															size="xs"
															variant="default"
															loading={call.isPending && call.variables?.fields?.slug === space.slug}
															onClick={() => {
																if (window.confirm("Rotate the link? Every old link stops working and you must send the partner the new one."))
																	call.mutate({ action: "update", fields: { slug: space.slug, rotate: true } });
															}}
														>
															Rotate link
														</Button>
														<Button
															size="xs"
															variant="default"
															color="red"
															onClick={() =>
																call.mutate({
																	action: "update",
																	fields: { slug: space.slug, status: space.status === "active" ? "revoked" : "active" },
																})
															}
														>
															{space.status === "active" ? "Revoke" : "Reactivate"}
														</Button>
													</Group>
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

			{editing && (
				<CardLayout>
					<Stack gap="sm">
						<Title order={4}>Edit wallets and note</Title>
						{walletInputs(editWallets, setEditWallets)}
						<Textarea
							label="Note shown to the partner"
							value={editNote}
							onChange={(event) => setEditNote(event.currentTarget.value)}
							maxLength={500}
							autosize
							minRows={2}
						/>
						<Select
							label="Partner pool (the gauge the keeper votes and the portal shows)"
							placeholder="Select the partner's pool"
							data={editPoolOptions}
							value={editPool}
							onChange={setEditPool}
							searchable
						/>
						<Group>
							<Button
								loading={call.isPending}
								onClick={() => {
									call.mutate(
										{
											action: "update",
											fields: {
												slug: editing,
												wallets: editWallets.filter((w) => w.trim()),
												note: editNote,
												// null leaves the recorded pool unchanged
												poolAddress: editPool,
											},
										},
										{ onSuccess: () => setEditing(null) },
									);
								}}
							>
								Save
							</Button>
							<Button variant="default" onClick={() => setEditing(null)}>
								Cancel
							</Button>
						</Group>
					</Stack>
				</CardLayout>
			)}

			<CardLayout>
				<Stack gap="sm">
					<Title order={4}>Create a partner space</Title>
					<Select
						label="Approved token listing"
						placeholder={listings.isLoading ? "Loading…" : "Pick a listing"}
						data={listingOptions}
						value={mint}
						searchable
						onChange={(value) => {
							setMint(value);
							setPoolAddress(null);
							const entry = approved.find((e) => e.mint === value);
							if (entry && !projectName) setProjectName(entry.name);
						}}
						nothingFoundMessage="No approved listing without a space"
					/>
					<TextInput label="Project name" value={projectName} onChange={(event) => setProjectName(event.currentTarget.value)} maxLength={80} />
					<Select
						label="Partner pool (shows its gauge status)"
						placeholder="Optional"
						data={poolOptions}
						value={poolAddress}
						onChange={setPoolAddress}
						clearable
						searchable
					/>
					{walletInputs(wallets, setWallets)}
					<Textarea label="Note shown to the partner (optional)" value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={500} autosize minRows={2} />
					<Group>
						<Button
							loading={call.isPending && call.variables?.action === "create"}
							disabled={!mint || !projectName.trim() || wallets.every((w) => !w.trim())}
							onClick={() =>
								call.mutate(
									{
										action: "create",
										fields: {
											mint,
											projectName: projectName.trim(),
											wallets: wallets.filter((w) => w.trim()),
											poolAddress: poolAddress ?? "",
											note,
										},
									},
									{
										onSuccess: (data) => {
											if (data.space) void copy(data.space.slug);
											setMint(null);
											setProjectName("");
											setPoolAddress(null);
											setWallets(blankWallets());
											setNote("");
										},
									},
								)
							}
						>
							Create and copy link
						</Button>
					</Group>
				</Stack>
			</CardLayout>
			<AdminPartnerVoteCheck spaces={spaces} />
		</Stack>
	);
};
