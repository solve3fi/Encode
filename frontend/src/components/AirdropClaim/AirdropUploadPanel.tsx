"use client";

import { useLingui } from "@lingui/react";
import {
	Alert,
	Button,
	Divider,
	FileInput,
	Group,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { notification } from "@/components/Notifications";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { toHex } from "@/lib/adminAuthPayload";
import {
	AIRDROP_PARTNERS,
	ASSIGNED_ALLOCATION,
	COMMUNITY_ALLOCATION,
	PARTNER_BUDGETS,
	RESERVED_ALLOCATION,
} from "@/lib/airdropSnapshot";
import { CardLayout } from "../Layout/CardLayout";

type UploadResult = {
	added: number;
	updated: number;
	totalAllocations: number;
	totalAmount: number;
	reservedAmount: number;
};

type ActivateResult = {
	added: number;
	updated: number;
	removed: number;
	totalAllocations: number;
	totalAmount: number;
};

export const AirdropUploadPanel: React.FC = () => {
	const { i18n } = useLingui();
	const { sign } = useAdminAuth();
	const [file, setFile] = useState<File | null>(null);
	const [clearAddress, setClearAddress] = useState("");
	const queryClient = useQueryClient();

	const summaryQuery = useQuery({
		queryKey: ["airdrop-summary"],
		queryFn: async () => {
			const res = await fetch("/api/airdrop/upload");
			if (!res.ok) throw new Error("Failed to load summary");
			return res.json() as Promise<{
				total: number;
				minted: number;
				locked: number;
				draft: {
					total: number;
					totalAmount: number;
					reservedAmount: number;
				} | null;
			}>;
		},
	});

	const uploadMutation = useMutation({
		mutationFn: async () => {
			if (!file) throw new Error("Choose a spreadsheet first");
			const fileBytes = await file.arrayBuffer();
			const fileHash = toHex(await crypto.subtle.digest("SHA-256", fileBytes));
			const { wallet, message, signature } = await sign("upload airdrop", {
				fileName: file.name,
				fileHash,
			});

			const formData = new FormData();
			formData.append("wallet", wallet);
			formData.append("message", message);
			formData.append("signature", signature);
			formData.append("file", file);

			const res = await fetch("/api/airdrop/upload", {
				method: "POST",
				body: formData,
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Upload failed");
			return data as UploadResult;
		},
		onSuccess: (data) => {
			notification.success({
				title: i18n._("Airdrop"),
				message: i18n._(
					"Prepared draft: {total} recipients. Live claims were not changed.",
					{
						added: data.added,
						updated: data.updated,
						total: data.totalAllocations,
					},
				),
			});
			setFile(null);
			queryClient.invalidateQueries({ queryKey: ["airdrop-summary"] });
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Airdrop"), message: error.message });
		},
	});

	const activateMutation = useMutation({
		mutationFn: async () => {
			const { wallet, message, signature } = await sign(
				"activate airdrop draft",
				{},
			);
			const res = await fetch("/api/admin/airdrop-activate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, message, signature }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Activation failed");
			return data as ActivateResult;
		},
		onSuccess: (data) => {
			notification.success({
				title: i18n._("Airdrop"),
				message: i18n._(
					"Activated: {total} addresses now claimable, {amount} SOLV3",
					{
						total: data.totalAllocations,
						amount: data.totalAmount.toLocaleString(),
					},
				),
			});
			queryClient.invalidateQueries({ queryKey: ["airdrop-summary"] });
			queryClient.invalidateQueries({ queryKey: ["airdrop-status"] });
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Airdrop"), message: error.message });
		},
	});

	const clearClaimMutation = useMutation({
		mutationFn: async () => {
			const ethAddress = clearAddress.trim().toLowerCase();
			const { wallet, message, signature } = await sign("clear airdrop claim", {
				ethAddress,
			});
			const res = await fetch("/api/admin/airdrop-clear-claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ wallet, message, signature, ethAddress }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Failed to clear claim");
			return data as { cleared: string; wasMinted: boolean; wasLocked: boolean };
		},
		onSuccess: (data) => {
			notification.success({
				title: i18n._("Airdrop"),
				message: i18n._("Cleared {address} -- it can now be claimed or overwritten by the next activated draft", {
					address: data.cleared,
				}),
			});
			setClearAddress("");
			queryClient.invalidateQueries({ queryKey: ["airdrop-summary"] });
			queryClient.invalidateQueries({ queryKey: ["airdrop-partner-stats"] });
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Airdrop"), message: error.message });
		},
	});

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Prepare Airdrop Snapshot")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Upload the reconciled recipients.csv export or the complete XLSX workbook with one tab per partner: {partners}. {fullBudget} SOLV3 each for a full partner; Equalizer and Scale split that in half ({halfBudget} SOLV3 each) since Equalizer users may hold either token. Total: {assigned} allocated; {reserved} reserved out of {community}. The CSV includes exact token amounts and per-partner allocations for validation. Re-uploading replaces the draft and does not add the amounts again.",
						{
							partners: AIRDROP_PARTNERS.join(", "),
							fullBudget: PARTNER_BUDGETS.THENA.toLocaleString(),
							halfBudget: PARTNER_BUDGETS.Equalizer.toLocaleString(),
							assigned: ASSIGNED_ALLOCATION.toLocaleString(),
							reserved: RESERVED_ALLOCATION.toLocaleString(),
							community: COMMUNITY_ALLOCATION.toLocaleString(),
						},
					)}
				</Text>
				<Alert
					color="orange"
					title={i18n._("Draft only — claims not activated")}
				>
					{i18n._(
						"Uploading only prepares a draft — it never mints, transfers, or changes the live claim list on its own. Activate the draft below when you're ready to make it claimable; claiming now transfers and permanently locks SOLV3 in one transaction, so previously claimed wallets are always preserved on activation.",
					)}
				</Alert>
				{summaryQuery.data?.draft && (
					<Group justify="space-between" align="center" wrap="wrap">
						<Text fz="sm">
							{i18n._(
								"Prepared draft: {total} wallets; {amount} SOLV3 allocated; {reserve} SOLV3 reserved",
								{
									total: summaryQuery.data.draft.total,
									amount: summaryQuery.data.draft.totalAmount.toLocaleString(),
									reserve:
										summaryQuery.data.draft.reservedAmount.toLocaleString(),
								},
							)}
						</Text>
						<Button
							size="xs"
							color="orange"
							loading={activateMutation.isPending}
							onClick={() => activateMutation.mutate()}
						>
							{i18n._("Activate draft")}
						</Button>
					</Group>
				)}
				{summaryQuery.data && (
					<Text fz="sm" c="gray">
						{i18n._(
							"Current list: {total} addresses, {minted} claimed, {locked} locked",
							{
								total: summaryQuery.data.total,
								minted: summaryQuery.data.minted,
								locked: summaryQuery.data.locked,
							},
						)}
					</Text>
				)}
				<FileInput
					placeholder={i18n._(
						"Select recipients.csv or the {count}-tab .xlsx file",
						{ count: AIRDROP_PARTNERS.length },
					)}
					accept=".csv,.xlsx,.xls"
					value={file}
					onChange={setFile}
				/>
				<Group justify="flex-end">
					<Button
						loading={uploadMutation.isPending}
						disabled={!file}
						onClick={() => uploadMutation.mutate()}
					>
						{i18n._("Prepare draft")}
					</Button>
				</Group>
				<Divider
					my="xs"
					label={i18n._("Clear a test claim")}
					labelPosition="left"
				/>
				<Text fz="sm" c="gray">
					{i18n._(
						"Deletes one wallet's record from the live ledger. Use this only for a test/QA claim that isn't a real recipient — a genuine claim is meant to be permanent, and activating a new draft refuses to touch any address it finds already claimed until you clear it here.",
					)}
				</Text>
				<Group align="flex-end" wrap="nowrap">
					<TextInput
						flex={1}
						placeholder={i18n._("0x… wallet to clear")}
						value={clearAddress}
						onChange={(event) => setClearAddress(event.currentTarget.value)}
					/>
					<Button
						color="red"
						variant="light"
						loading={clearClaimMutation.isPending}
						disabled={!/^0x[a-fA-F0-9]{40}$/.test(clearAddress.trim())}
						onClick={() => clearClaimMutation.mutate()}
					>
						{i18n._("Clear claim")}
					</Button>
				</Group>
			</Stack>
		</CardLayout>
	);
};
