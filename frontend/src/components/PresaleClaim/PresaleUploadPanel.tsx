"use client";

import { useLingui } from "@lingui/react";
import { Alert, Button, FileInput, Group, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { notification } from "@/components/Notifications";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { toHex } from "@/lib/adminAuthPayload";
import { CardLayout } from "../Layout/CardLayout";

type UploadResult = {
	added: number;
	updated: number;
	totalAllocations: number;
	totalUsd: number;
	totalVeSolv3: number;
};

type ActivateResult = {
	added: number;
	updated: number;
	removed: number;
	totalAllocations: number;
	totalUsd: number;
	totalVeSolv3: number;
};

export const PresaleUploadPanel: React.FC = () => {
	const { i18n } = useLingui();
	const { sign } = useAdminAuth();
	const [file, setFile] = useState<File | null>(null);
	const queryClient = useQueryClient();

	const summaryQuery = useQuery({
		queryKey: ["presale-summary"],
		queryFn: async () => {
			const res = await fetch("/api/presale/upload");
			if (!res.ok) throw new Error("Failed to load summary");
			return res.json() as Promise<{
				total: number;
				minted: number;
				locked: number;
				draft: {
					total: number;
					totalUsd: number;
					totalVeSolv3: number;
				} | null;
			}>;
		},
	});

	const uploadMutation = useMutation({
		mutationFn: async () => {
			if (!file) throw new Error("Choose a spreadsheet first");
			const fileBytes = await file.arrayBuffer();
			const fileHash = toHex(await crypto.subtle.digest("SHA-256", fileBytes));
			const { wallet, message, signature } = await sign("upload presale allocations", {
				fileName: file.name,
				fileHash,
			});

			const formData = new FormData();
			formData.append("wallet", wallet);
			formData.append("message", message);
			formData.append("signature", signature);
			formData.append("file", file);

			const res = await fetch("/api/presale/upload", {
				method: "POST",
				body: formData,
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Upload failed");
			return data as UploadResult;
		},
		onSuccess: (data) => {
			notification.success({
				title: i18n._("Presale"),
				message: i18n._(
					"Prepared draft: {total} buyers. Live claims were not changed.",
					{
						added: data.added,
						updated: data.updated,
						total: data.totalAllocations,
					},
				),
			});
			setFile(null);
			queryClient.invalidateQueries({ queryKey: ["presale-summary"] });
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Presale"), message: error.message });
		},
	});

	const activateMutation = useMutation({
		mutationFn: async () => {
			const { wallet, message, signature } = await sign(
				"activate presale draft",
				{},
			);
			const res = await fetch("/api/admin/presale-activate", {
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
				title: i18n._("Presale"),
				message: i18n._(
					"Activated: {total} addresses now claimable, {amount} SOLV3",
					{
						total: data.totalAllocations,
						amount: data.totalVeSolv3.toLocaleString(),
					},
				),
			});
			queryClient.invalidateQueries({ queryKey: ["presale-summary"] });
			queryClient.invalidateQueries({ queryKey: ["presale-status"] });
		},
		onError: (error: Error) => {
			notification.error({ title: i18n._("Presale"), message: error.message });
		},
	});

	return (
		<CardLayout>
			<Stack gap="md">
				<Text fz="lg" fw="bold">
					{i18n._("Prepare Presale Claim Snapshot")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Upload a CSV/XLSX with columns solana_address, amount_usd and ve_solv3_amount. Re-uploading replaces the draft and does not add the amounts again.",
					)}
				</Text>
				<Alert
					color="orange"
					title={i18n._("Draft only — claims not activated")}
				>
					{i18n._(
						"Uploading only prepares a draft — it never mints, transfers, or changes the live claim list on its own. Activate the draft below when you're ready to make it claimable; claiming transfers and permanently locks SOLV3 in one transaction, so previously claimed wallets are always preserved on activation.",
					)}
				</Alert>
				{summaryQuery.data?.draft && (
					<Group justify="space-between" align="center" wrap="wrap">
						<Text fz="sm">
							{i18n._(
								"Prepared draft: {total} wallets; {amount} SOLV3 allocated (${usd})",
								{
									total: summaryQuery.data.draft.total,
									amount: summaryQuery.data.draft.totalVeSolv3.toLocaleString(),
									usd: summaryQuery.data.draft.totalUsd.toLocaleString(),
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
					placeholder={i18n._("Select the presale allocation CSV/XLSX")}
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
			</Stack>
		</CardLayout>
	);
};
