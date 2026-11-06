"use client";

import { useLingui } from "@lingui/react";
import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { PublicKey } from "@solana/web3.js";
import { useMemo, useState } from "react";
import { PARTNER_VOTER } from "@/configs/partnerVoter";
import { usePartnerVoters } from "@/hooks/usePartnerVoters";
import { formatAddress } from "@/lib/format";
import {
	useRemovePartnerVoter,
	useSetPartnerVoter,
} from "@/stores/admin/hooks/usePartnerVoterAdmin";
import { CardLayout } from "../Layout/CardLayout";

/**
 * Admin: partner voters. Locks voted by a flagged wallet pay no auto-vote fee (everyone else pays 15%). Flagged
 * wallets are hidden from the public auto-voter list; partners choose them on their partner page.
 */
export function AdminPartnerVoters() {
	const { i18n } = useLingui();
	const { data: partnerVoters = [], isLoading } = usePartnerVoters();
	const add = useSetPartnerVoter();
	const remove = useRemovePartnerVoter();
	const sharedVoter = PARTNER_VOTER;
	const [input, setInput] = useState("");
	const voter = useMemo(() => {
		try {
			return input.trim() ? new PublicKey(input.trim()) : null;
		} catch {
			return null;
		}
	}, [input]);

	return (
		<CardLayout>
			<Stack gap="sm">
				<Text fz="lg" fw="bold">
					{i18n._("Partner voters")}
				</Text>
				<Text fz="sm" c="gray">
					{i18n._(
						"Locks voted by a partner voter pay no auto-vote fee; everyone else pays 15%. Partner voters are hidden from the public auto-voter list.",
					)}
				</Text>
				{isLoading ? (
					<Text fz="xs" c="gray">
						{i18n._("Loading…")}
					</Text>
				) : partnerVoters.length === 0 ? (
					<Text fz="xs" c="gray">
						{i18n._("No partner voters yet.")}
					</Text>
				) : (
					partnerVoters.map((entry) => (
						<Group key={entry.voter} justify="space-between">
							<Text fz="sm" ff="monospace" title={entry.voter}>
								{formatAddress(entry.voter)}
							</Text>
							<Button
								size="xs"
								variant="default"
								loading={
									remove.isPending && remove.variables?.toBase58() === entry.voter
								}
								onClick={() => remove.mutate(new PublicKey(entry.voter))}
							>
								{i18n._("Remove")}
							</Button>
						</Group>
					))
				)}
				{sharedVoter &&
				!partnerVoters.some((entry) => entry.voter === sharedVoter.toBase58()) ? (
					<Group>
						<Button
							variant="light"
							onClick={() => setInput(sharedVoter.toBase58())}
						>
							{i18n._("Fill in the shared partner voter")}
						</Button>
					</Group>
				) : null}
				<TextInput
					label={i18n._("Partner voter wallet")}
					value={input}
					onChange={(e) => setInput(e.currentTarget.value)}
					error={input && !voter ? i18n._("Invalid address") : null}
				/>
				<Group>
					<Button
						disabled={!voter}
						loading={add.isPending}
						onClick={() => voter && add.mutate(voter, { onSuccess: () => setInput("") })}
					>
						{i18n._("Add partner voter")}
					</Button>
				</Group>
			</Stack>
		</CardLayout>
	);
}
