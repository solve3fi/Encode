"use client";

import {
	Badge,
	Button,
	Group,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
	QUEST_PAUSE_REASON_MAX,
	QUEST_PAUSE_SET_ACTION,
	QUEST_PAUSE_SWITCHES,
	QUEST_PAUSES_READ_ACTION,
	type QuestPauseKey,
	type QuestPauseStatus,
	questPauseSetPayload,
} from "@/configs/questPauses";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { formatAddress } from "@/lib/format";
import { CardLayout } from "../Layout/CardLayout";

type Call =
	| { action: "read" }
	| { action: "set"; key: QuestPauseKey; paused: boolean; reason: string };

const when = (iso: string | null) =>
	iso ? new Date(iso).toLocaleString() : "";

/**
 * The Quest emergency stops. Each switch stops one XP or Pass path inside the Quest database, so every
 * writer honours it. Pausing never loses anything: evidence keeps being recorded and held-back awards are
 * made when a switch is released. Every change is a signed admin action and is kept in an audit trail.
 */
export const AdminQuestControls: React.FC = () => {
	const { sign } = useAdminAuth();
	const [status, setStatus] = useState<QuestPauseStatus | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [pausing, setPausing] = useState<QuestPauseKey | null>(null);
	const [reason, setReason] = useState("");

	const call = useMutation({
		mutationFn: async (input: Call) => {
			const [name, payload] =
				input.action === "read"
					? [QUEST_PAUSES_READ_ACTION, {}]
					: [
							QUEST_PAUSE_SET_ACTION,
							questPauseSetPayload(input.key, input.paused, input.reason),
						];
			const auth = await sign(name, payload);
			const res = await fetch("/api/admin/quest-pauses", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...auth,
					action: input.action,
					...(input.action === "set"
						? { key: input.key, paused: input.paused, reason: payload.reason }
						: {}),
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Request failed");
			return data as { pauses: QuestPauseStatus };
		},
		onSuccess: (data, input) => {
			setStatus(data.pauses);
			if (input.action === "set") {
				setPausing(null);
				setReason("");
				setMessage(input.paused ? "Paused." : "Released.");
			} else {
				setMessage(null);
			}
		},
		onError: (error: Error) => setMessage(error.message),
	});

	const busy = call.isPending;

	return (
		<Stack gap="lg">
			<CardLayout>
				<Stack gap="md">
					<Group justify="space-between">
						<Title order={3}>Quest controls</Title>
						<Button
							loading={busy && call.variables?.action === "read"}
							onClick={() => call.mutate({ action: "read" })}
						>
							{status ? "Reload" : "Load (sign)"}
						</Button>
					</Group>
					<Text size="sm" c="dimmed">
						Emergency stops for Devnet Quest XP. Each one stops a single path.
						Nothing is lost while paused: votes, swaps, liquidity and Pass mints
						keep being recorded, and held-back awards are made when you release
						the switch. Every change is signed by your wallet and kept in an
						audit trail.
					</Text>
					{message && <Text size="sm">{message}</Text>}
				</Stack>
			</CardLayout>

			{status &&
				QUEST_PAUSE_SWITCHES.map((item) => {
					const entry = status[item.key];
					const paused = entry?.paused === true;
					const open = pausing === item.key;
					return (
						<CardLayout key={item.key}>
							<Stack gap="sm">
								<Group justify="space-between" align="flex-start">
									<Stack gap={2}>
										<Group gap="sm">
											<Title order={4}>{item.label}</Title>
											<Badge color={paused ? "red" : "teal"} variant="light">
												{paused ? "Paused" : "Running"}
											</Badge>
										</Group>
										<Text size="sm" c="dimmed">
											When paused: {item.pauses}
										</Text>
										<Text size="sm" c="dimmed">
											When released: {item.resumes}
										</Text>
										{paused && (
											<Text size="sm">
												Reason: {entry?.reason ?? "—"}
												{entry?.changedBy
													? ` · by ${formatAddress(entry.changedBy)} · ${when(entry.changedAt)}`
													: ""}
											</Text>
										)}
									</Stack>
									{paused ? (
										<Button
											variant="default"
											loading={
												busy &&
												call.variables?.action === "set" &&
												call.variables.key === item.key
											}
											onClick={() =>
												call.mutate({
													action: "set",
													key: item.key,
													paused: false,
													reason: "",
												})
											}
										>
											Release
										</Button>
									) : (
										<Button
											color="red"
											variant="light"
											disabled={busy}
											onClick={() => {
												setPausing(open ? null : item.key);
												setReason("");
											}}
										>
											{open ? "Cancel" : "Pause…"}
										</Button>
									)}
								</Group>
								{open && !paused && (
									<Group align="flex-end">
										<TextInput
											style={{ flex: 1 }}
											label="Why are you pausing this? (kept in the audit)"
											placeholder="For example: investigating a payout"
											maxLength={QUEST_PAUSE_REASON_MAX}
											value={reason}
											onChange={(event) => setReason(event.currentTarget.value)}
										/>
										<Button
											color="red"
											disabled={reason.trim().length === 0}
											loading={
												busy &&
												call.variables?.action === "set" &&
												call.variables.key === item.key
											}
											onClick={() =>
												call.mutate({
													action: "set",
													key: item.key,
													paused: true,
													reason,
												})
											}
										>
											Confirm pause (sign)
										</Button>
									</Group>
								)}
							</Stack>
						</CardLayout>
					);
				})}
		</Stack>
	);
};
