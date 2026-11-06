"use client";

import { useLingui } from "@lingui/react";
import {
	Avatar,
	Button,
	Group,
	Select,
	Stack,
	Table,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { notification } from "@/components/Notifications";
import {
	TOKEN_LINKS_ADMIN_ACTION,
	type TokenLinkOverride,
	type TokenLinksById,
} from "@/configs/tokenLinks";
import { SOLVE3_DEVNET_TOKENS } from "@/configs/tokens";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useAdminPickers } from "@/stores/admin/hooks/useAdminPickers";
import { formatAddress } from "@/lib/format";
import { CardLayout } from "../Layout/CardLayout";

export const AdminTokenLinks: React.FC = () => {
	const { i18n } = useLingui();
	const { sign } = useAdminAuth();
	const queryClient = useQueryClient();

	const [mint, setMint] = useState("");
	const [website, setWebsite] = useState("");
	const [twitter, setTwitter] = useState("");

	const linksQuery = useQuery({
		queryKey: ["admin-token-links"],
		queryFn: async () => {
			const res = await fetch("/api/admin/token-links");
			if (!res.ok) throw new Error("Failed to load");
			return res.json() as Promise<TokenLinksById>;
		},
	});

	const { tokenOptions: poolTokenOptions } = useAdminPickers();
	// Every token a live pool trades, plus the static devnet list as a fallback.
	const knownTokenOptions = useMemo(() => {
		const byAddress = new Map<string, string>();
		for (const token of SOLVE3_DEVNET_TOKENS)
			byAddress.set(token.address, `${token.symbol} — ${formatAddress(token.address)}`);
		for (const option of poolTokenOptions) byAddress.set(option.value, option.label);
		return [...byAddress.entries()].map(([value, label]) => ({ value, label }));
	}, [poolTokenOptions]);

	const saveMutation = useMutation({
		mutationFn: async ({
			mint: targetMint,
			website: targetWebsite,
			twitter: targetTwitter,
		}: {
			mint: string;
			website: string;
			twitter: string;
		}) => {
			const { wallet, message, signature } = await sign(
				TOKEN_LINKS_ADMIN_ACTION,
				{ mint: targetMint, website: targetWebsite, twitter: targetTwitter },
			);
			const res = await fetch("/api/admin/token-links", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					wallet,
					message,
					signature,
					mint: targetMint,
					website: targetWebsite,
					twitter: targetTwitter,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Save failed");
			return data as { mint: string; link: TokenLinkOverride | null };
		},
		onSuccess: ({ mint: savedMint, link }) => {
			queryClient.setQueryData<TokenLinksById>(
				["admin-token-links"],
				(prev) => {
					const next = { ...prev };
					if (link) next[savedMint] = link;
					else delete next[savedMint];
					return next;
				},
			);
			queryClient.invalidateQueries({ queryKey: ["token-list-extra"] });
			notification.success({
				title: i18n._("Token Links"),
				message: i18n._("Saved"),
			});
			setMint("");
			setWebsite("");
			setTwitter("");
		},
		onError: (error: Error) => {
			notification.error({
				title: i18n._("Token Links"),
				message: error.message,
			});
		},
	});

	const loadForEdit = (targetMint: string, link: TokenLinkOverride) => {
		setMint(targetMint);
		setWebsite(link.website ?? "");
		setTwitter(link.twitter ?? "");
	};

	const records = Object.entries(linksQuery.data ?? {}).sort(
		(a, b) => b[1].updatedAt - a[1].updatedAt,
	);

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Token Website & Social Links")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Set or update the Website/X links shown next to a pool's verified checkmark — works for any token, including official pairs that already resolve a name (WIF3, SOLV3, ...) but aren't going through the public listing request flow.",
					)}
				</Text>

				<Group align="flex-end" gap="sm" wrap="wrap">
					<Select
						label={i18n._("Known token")}
						placeholder={i18n._("Pick a token…")}
						data={knownTokenOptions}
						value={
							knownTokenOptions.some((option) => option.value === mint)
								? mint
								: null
						}
						onChange={(value) => setMint(value ?? "")}
						searchable
						clearable
						flex={1}
						miw={220}
					/>
					<TextInput
						label={i18n._("Mint address")}
						placeholder="So1111...1112"
						value={mint}
						onChange={(event) => setMint(event.currentTarget.value)}
						flex={1}
						miw={220}
					/>
				</Group>
				<Group align="flex-end" gap="sm" wrap="wrap">
					<TextInput
						label={i18n._("Website")}
						placeholder="https://"
						value={website}
						onChange={(event) => setWebsite(event.currentTarget.value)}
						flex={1}
						miw={200}
					/>
					<TextInput
						label={i18n._("X (Twitter)")}
						placeholder="https://x.com/…"
						value={twitter}
						onChange={(event) => setTwitter(event.currentTarget.value)}
						flex={1}
						miw={200}
					/>
					<Button
						loading={saveMutation.isPending}
						disabled={!mint.trim()}
						onClick={() =>
							saveMutation.mutate({ mint: mint.trim(), website, twitter })
						}
					>
						{i18n._("Save")}
					</Button>
				</Group>

				<Table.ScrollContainer minWidth={640}>
					<Table verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th>{i18n._("Token")}</Table.Th>
								<Table.Th>{i18n._("Website")}</Table.Th>
								<Table.Th>{i18n._("X")}</Table.Th>
								<Table.Th>{i18n._("Actions")}</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{records.length === 0 && (
								<Table.Tr>
									<Table.Td colSpan={4}>
										<Text c="gray" ta="center" py="md">
											{linksQuery.isLoading
												? i18n._("Loading…")
												: i18n._("No token links set yet")}
										</Text>
									</Table.Td>
								</Table.Tr>
							)}
							{records.map(([recordMint, link]) => {
								const known = SOLVE3_DEVNET_TOKENS.find(
									(token) => token.address === recordMint,
								);
								return (
									<Table.Tr key={recordMint}>
										<Table.Td>
											<Group gap="sm">
												{known?.logoURI && (
													<Avatar src={known.logoURI} size={24} radius="md" />
												)}
												<Stack gap={0}>
													<Text fw="bold">
														{known?.symbol ?? formatAddress(recordMint)}
													</Text>
													<Text fz="xs" c="gray" ff="monospace">
														{formatAddress(recordMint)}
													</Text>
												</Stack>
											</Group>
										</Table.Td>
										<Table.Td>
											<Text fz="xs" truncate maw={200}>
												{link.website ?? "—"}
											</Text>
										</Table.Td>
										<Table.Td>
											<Text fz="xs" truncate maw={160}>
												{link.twitter ?? "—"}
											</Text>
										</Table.Td>
										<Table.Td>
											<Group gap="xs">
												<Button
													size="xs"
													variant="light"
													onClick={() => loadForEdit(recordMint, link)}
												>
													{i18n._("Edit")}
												</Button>
												<Button
													size="xs"
													variant="light"
													color="red"
													loading={
														saveMutation.isPending &&
														saveMutation.variables?.mint === recordMint
													}
													onClick={() =>
														saveMutation.mutate({
															mint: recordMint,
															website: "",
															twitter: "",
														})
													}
												>
													{i18n._("Clear")}
												</Button>
											</Group>
										</Table.Td>
									</Table.Tr>
								);
							})}
						</Table.Tbody>
					</Table>
				</Table.ScrollContainer>
			</Stack>
		</CardLayout>
	);
};
