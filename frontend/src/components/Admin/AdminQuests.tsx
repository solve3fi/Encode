"use client";

import {
	Alert,
	Badge,
	Button,
	Checkbox,
	Group,
	NumberInput,
	Select,
	Stack,
	Table,
	Tabs,
	Text,
	Textarea,
	TextInput,
	Title,
} from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
	type PartnerLead,
	QUEST_ADMIN_ACTIONS,
	QUEST_ID_PATTERN,
	QUEST_METRICS,
	type QuestAdminAction,
	type QuestAdminOverview,
	type QuestManualGoal,
	type QuestPlan,
	type QuestTemplate,
} from "@/configs/questAdmin";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { formatAddress } from "@/lib/format";
import { CardLayout } from "../Layout/CardLayout";

const DAY = 86_400_000;
const utcDate = (iso: string) => iso.slice(0, 10);
const metricLabel = (key: string) =>
	QUEST_METRICS.find((m) => m.key === key)?.label ?? key;

// The campaigns an admin can open: the one the site is on, the first-year plan, and the earlier test plan.
const CAMPAIGN_CHOICES = [
	...(process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN
		? [
				{
					value: process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN,
					label: `${process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN} (site is on this)`,
				},
			]
		: []),
	{
		value: "solve3-devnet-quests-y1",
		label: "solve3-devnet-quests-y1 (first-year plan)",
	},
	{
		value: "solve3-devnet-test-2026",
		label: "solve3-devnet-test-2026 (earlier test plan)",
	},
];

type Call = { action: QuestAdminAction; params: Record<string, unknown> };
type GoalForm = {
	id: string;
	title: string;
	flavorText: string;
	startsOn: string;
	endsOn: string;
	xp: number;
	editing: boolean;
};
const emptyGoal: GoalForm = {
	id: "",
	title: "Get a partner onboarded",
	flavorText: "Somebody important said yes. Make sure they actually mean it.",
	startsOn: "",
	endsOn: "",
	xp: 1000,
	editing: false,
};
const emptyTemplate: QuestTemplate = {
	id: "",
	title: "",
	flavorText: "",
	description: "",
	metric: "qualifyingSwaps",
	target: 1,
	testXp: 100,
};

/**
 * The Quest calendar and the monthly community goals. Every action is signed by the admin wallet; the server
 * refuses to change anything that has already started (a started week, a started goal, a completed goal), and
 * it says why. Weekly quests change by editing a draft here and publishing it as a new revision; monthly goals
 * are completed by hand, which pays every Passport that exists at that moment, once.
 */
export const AdminQuests: React.FC = () => {
	const { sign } = useAdminAuth();
	const [campaignId, setCampaignId] = useState(
		process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN ?? "",
	);
	const [overview, setOverview] = useState<QuestAdminOverview | null>(null);
	const [draft, setDraft] = useState<QuestPlan | null>(null);
	const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(
		null,
	);
	const [goalForm, setGoalForm] = useState<GoalForm>(emptyGoal);
	const [completing, setCompleting] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [newQuest, setNewQuest] = useState<QuestTemplate>(emptyTemplate);
	// Partner Scout leads: loaded on request, and each decision carries an optional note.
	const [leads, setLeads] = useState<{
		bountyXp: number;
		leads: PartnerLead[];
	} | null>(null);
	const [deciding, setDeciding] = useState<{
		id: number;
		kind: "onboard" | "reject";
	} | null>(null);
	const [leadNote, setLeadNote] = useState("");
	const [leadConfirmed, setLeadConfirmed] = useState(false);

	const call = useMutation({
		mutationFn: async ({ action, params }: Call) => {
			const auth = await sign(QUEST_ADMIN_ACTIONS[action], params);
			const res = await fetch("/api/admin/quests", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...auth, action, params }),
			});
			const data = await res.json();
			if (!res.ok) {
				throw new Error(
					data.detail
						? `${data.error}: ${data.detail}`
						: (data.error ?? "Request failed"),
				);
			}
			return data as Record<string, unknown>;
		},
		onError: (error: Error) => setMessage({ text: error.message, bad: true }),
	});
	const busy = call.isPending;

	const load = () =>
		call.mutate(
			{ action: "overview", params: { campaignId } },
			{
				onSuccess: (data) => {
					const next = data as unknown as QuestAdminOverview;
					setOverview(next);
					setDraft(next.plan ? structuredClone(next.plan.plan) : null);
					setMessage(null);
				},
			},
		);

	const published = overview?.plan?.plan ?? null;
	const nowMs = Date.now();
	const weekState = (startsOn: string) => {
		const start = Date.parse(`${startsOn}T00:00:00.000Z`);
		return nowMs >= start + 7 * DAY
			? "Past"
			: nowMs >= start
				? "Current"
				: "Upcoming";
	};
	const templateById = useMemo(
		() => new Map((draft?.templates ?? []).map((t) => [t.id, t])),
		[draft],
	);
	const usage = useMemo(() => {
		const counts = new Map<string, number>();
		for (const week of draft?.weeks ?? [])
			for (const id of week.questIds) counts.set(id, (counts.get(id) ?? 0) + 1);
		return counts;
	}, [draft]);

	const changes = useMemo(() => {
		if (!published || !draft) return [] as string[];
		const out: string[] = [];
		draft.weeks.forEach((week, index) => {
			const before = published.weeks[index]?.questIds.join(" · ");
			const after = week.questIds.join(" · ");
			if (before !== after)
				out.push(`Week ${index + 1} (${week.startsOn}): ${before} → ${after}`);
		});
		const before = new Map(published.templates.map((t) => [t.id, t]));
		for (const t of draft.templates) {
			const old = before.get(t.id);
			if (!old) out.push(`New quest: ${t.id}`);
			else if (JSON.stringify(old) !== JSON.stringify(t))
				out.push(`Edited quest: ${t.id}`);
		}
		for (const t of published.templates)
			if (!draft.templates.some((x) => x.id === t.id))
				out.push(`Removed quest: ${t.id}`);
		return out;
	}, [published, draft]);

	const setWeekQuest = (week: number, slot: number, id: string) =>
		setDraft((current) => {
			if (!current) return current;
			const next = structuredClone(current);
			next.weeks[week].questIds[slot] = id;
			return next;
		});
	const editTemplate = (id: string, patch: Partial<QuestTemplate>) =>
		setDraft((current) => {
			if (!current) return current;
			const next = structuredClone(current);
			const target = next.templates.find((t) => t.id === id);
			if (target) Object.assign(target, patch);
			return next;
		});
	const addTemplate = () => {
		setDraft((current) => {
			if (!current) return current;
			const next = structuredClone(current);
			next.templates.push({ ...newQuest });
			return next;
		});
		setNewQuest(emptyTemplate);
	};
	const removeTemplate = (id: string) =>
		setDraft((current) => {
			if (!current) return current;
			const next = structuredClone(current);
			next.templates = next.templates.filter((t) => t.id !== id);
			return next;
		});

	const publishChanges = () => {
		if (!overview?.plan || !draft) return;
		call.mutate(
			{
				action: "revise",
				params: { plan: draft, expectedRevision: overview.plan.revision },
			},
			{
				onSuccess: (data) => {
					const plan = data.plan as QuestAdminOverview["plan"];
					setOverview({ ...overview, plan });
					setDraft(plan ? structuredClone(plan.plan) : null);
					setMessage({
						text: `Published as revision ${plan?.revision ?? "?"}.`,
						bad: false,
					});
				},
			},
		);
	};

	const goalAction = (
		action: "save-goal" | "remove-goal" | "complete-goal",
		params: Record<string, unknown>,
		done: (data: Record<string, unknown>) => string,
	) =>
		call.mutate(
			{ action, params: { campaignId, ...params } },
			{
				onSuccess: (data) => {
					if (overview)
						setOverview({
							...overview,
							goals: data.goals as QuestManualGoal[],
						});
					setMessage({ text: done(data), bad: false });
				},
			},
		);

	const goalFormValid =
		QUEST_ID_PATTERN.test(goalForm.id) &&
		goalForm.title.trim().length > 0 &&
		goalForm.flavorText.trim().length > 0 &&
		/^\d{4}-\d{2}-\d{2}$/.test(goalForm.startsOn) &&
		/^\d{4}-\d{2}-\d{2}$/.test(goalForm.endsOn) &&
		goalForm.xp >= 1;
	const saveGoal = () =>
		goalAction(
			"save-goal",
			{
				goal: {
					id: goalForm.id,
					title: goalForm.title.trim(),
					flavorText: goalForm.flavorText.trim(),
					startsAt: `${goalForm.startsOn}T00:00:00.000Z`,
					endsAt: `${goalForm.endsOn}T00:00:00.000Z`,
					xp: goalForm.xp,
				},
			},
			() => "Goal saved.",
		);

	const loadLeads = () =>
		call.mutate(
			{ action: "leads", params: {} },
			{
				onSuccess: (data) => {
					setLeads({
						bountyXp: data.bountyXp as number,
						leads: data.leads as PartnerLead[],
					});
					setMessage(null);
				},
			},
		);
	const decideLead = (kind: "onboard" | "reject", leadId: number) =>
		call.mutate(
			{
				action: kind === "onboard" ? "onboard-lead" : "reject-lead",
				params: {
					leadId,
					...(leadNote.trim() ? { note: leadNote.trim() } : {}),
				},
			},
			{
				onSuccess: (data) => {
					setLeads({
						bountyXp: data.bountyXp as number,
						leads: data.leads as PartnerLead[],
					});
					setDeciding(null);
					setLeadNote("");
					setLeadConfirmed(false);
					setMessage({
						text:
							kind === "onboard"
								? `Marked onboarded. The scout was paid ${(data.bountyXp as number).toLocaleString()} XP.`
								: "Lead rejected.",
						bad: false,
					});
				},
			},
		);

	const templateOptions = (draft?.templates ?? []).map((t) => ({
		value: t.id,
		label: `${t.title} (+${t.testXp})`,
	}));
	const weekXp = (ids: string[]) =>
		ids.reduce((sum, id) => sum + (templateById.get(id)?.testXp ?? 0), 0);

	return (
		<Stack gap="lg">
			<CardLayout>
				<Stack gap="md">
					<Group justify="space-between" align="flex-end">
						<Title order={3}>Quests</Title>
						<Group align="flex-end">
							<Select
								label="Campaign"
								allowDeselect={false}
								data={CAMPAIGN_CHOICES.filter(
									(choice, index, all) =>
										all.findIndex((c) => c.value === choice.value) === index,
								)}
								value={campaignId}
								onChange={(value) => {
									if (!value) return;
									setCampaignId(value);
									setOverview(null);
									setDraft(null);
									setMessage(null);
								}}
								w={320}
							/>
							<Button
								loading={busy && call.variables?.action === "overview"}
								disabled={!QUEST_ID_PATTERN.test(campaignId)}
								onClick={load}
							>
								{overview ? "Reload" : "Load (sign)"}
							</Button>
						</Group>
					</Group>
					<Text size="sm" c="dimmed">
						The year of weekly quests and the monthly community goals. Weeks and
						goals that have started cannot be changed. Every change is signed by
						your wallet. All XP here is Devnet test XP.
					</Text>
					{message && (
						<Alert color={message.bad ? "red" : "teal"} variant="light">
							{message.text}
						</Alert>
					)}
				</Stack>
			</CardLayout>

			{overview && (
				<Tabs defaultValue="weekly" keepMounted={false}>
					<Tabs.List>
						<Tabs.Tab value="weekly">Weekly calendar</Tabs.Tab>
						<Tabs.Tab value="catalog">Quest catalog</Tabs.Tab>
						<Tabs.Tab value="goals">Monthly goals</Tabs.Tab>
						<Tabs.Tab value="leads">Partner leads</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel value="weekly" pt="md">
						<CardLayout>
							{!draft || !overview.plan ? (
								<Text size="sm">
									No calendar is published for this campaign yet.
								</Text>
							) : (
								<Stack gap="md">
									<Group justify="space-between">
										<Text size="sm" c="dimmed">
											Revision {overview.plan.revision} · {draft.weekCount}{" "}
											weeks from {draft.startsOn} · each week resets Thursday
											00:00 UTC
										</Text>
										<Badge color={changes.length ? "yellow" : "gray"}>
											{changes.length} unsaved change
											{changes.length === 1 ? "" : "s"}
										</Badge>
									</Group>
									<Table.ScrollContainer minWidth={900}>
										<Table verticalSpacing="xs" striped>
											<Table.Thead>
												<Table.Tr>
													<Table.Th>Week</Table.Th>
													<Table.Th>Starts (UTC)</Table.Th>
													<Table.Th>State</Table.Th>
													<Table.Th>Quest 1</Table.Th>
													<Table.Th>Quest 2</Table.Th>
													<Table.Th>Quest 3</Table.Th>
													<Table.Th>XP</Table.Th>
												</Table.Tr>
											</Table.Thead>
											<Table.Tbody>
												{draft.weeks.map((week, index) => {
													const state = weekState(week.startsOn);
													const editable = state === "Upcoming";
													return (
														<Table.Tr key={week.startsOn}>
															<Table.Td>{index + 1}</Table.Td>
															<Table.Td>{week.startsOn}</Table.Td>
															<Table.Td>
																<Badge
																	variant="light"
																	color={
																		state === "Current"
																			? "teal"
																			: state === "Past"
																				? "gray"
																				: "blue"
																	}
																>
																	{state}
																</Badge>
															</Table.Td>
															{[0, 1, 2].map((slot) => (
																<Table.Td key={slot}>
																	<Select
																		size="xs"
																		w={240}
																		allowDeselect={false}
																		disabled={!editable}
																		data={templateOptions}
																		value={week.questIds[slot]}
																		onChange={(value) =>
																			value && setWeekQuest(index, slot, value)
																		}
																	/>
																</Table.Td>
															))}
															<Table.Td>{weekXp(week.questIds)}</Table.Td>
														</Table.Tr>
													);
												})}
											</Table.Tbody>
										</Table>
									</Table.ScrollContainer>
									{changes.length > 0 && (
										<Alert color="yellow" variant="light" title="Review">
											<Stack gap={2}>
												{changes.map((line) => (
													<Text size="sm" key={line}>
														{line}
													</Text>
												))}
											</Stack>
										</Alert>
									)}
									<Group>
										<Button
											disabled={changes.length === 0 || busy}
											loading={busy && call.variables?.action === "revise"}
											onClick={publishChanges}
										>
											Publish changes (sign)
										</Button>
										<Button
											variant="default"
											disabled={changes.length === 0 || busy}
											onClick={() => setDraft(structuredClone(published))}
										>
											Discard
										</Button>
									</Group>
								</Stack>
							)}
						</CardLayout>
					</Tabs.Panel>

					<Tabs.Panel value="catalog" pt="md">
						<Stack gap="md">
							{!draft ? (
								<CardLayout>
									<Text size="sm">
										No calendar is published for this campaign yet.
									</Text>
								</CardLayout>
							) : (
								<>
									{draft.templates.map((t) => (
										<CardLayout key={t.id}>
											<Stack gap="xs">
												<Group justify="space-between">
													<Group gap="sm">
														<Title order={5}>{t.id}</Title>
														<Badge variant="light">
															{metricLabel(t.metric)}
														</Badge>
														<Badge variant="light" color="gray">
															used in {usage.get(t.id) ?? 0} week
															{(usage.get(t.id) ?? 0) === 1 ? "" : "s"}
														</Badge>
													</Group>
													{(usage.get(t.id) ?? 0) === 0 && (
														<Button
															size="xs"
															variant="subtle"
															color="red"
															onClick={() => removeTemplate(t.id)}
														>
															Remove
														</Button>
													)}
												</Group>
												<TextInput
													label="Title"
													maxLength={100}
													value={t.title}
													onChange={(event) =>
														editTemplate(t.id, {
															title: event.currentTarget.value,
														})
													}
												/>
												<TextInput
													label="Flavour line"
													maxLength={300}
													value={t.flavorText}
													onChange={(event) =>
														editTemplate(t.id, {
															flavorText: event.currentTarget.value,
														})
													}
												/>
												<Textarea
													label="What the player must do"
													maxLength={500}
													autosize
													minRows={2}
													value={t.description}
													onChange={(event) =>
														editTemplate(t.id, {
															description: event.currentTarget.value,
														})
													}
												/>
												<Group>
													<NumberInput
														label="Target"
														min={1}
														allowDecimal={false}
														value={t.target}
														onChange={(value) =>
															editTemplate(t.id, {
																target: Math.max(1, Number(value) || 1),
															})
														}
													/>
													<NumberInput
														label="XP"
														min={1}
														allowDecimal={false}
														value={t.testXp}
														onChange={(value) =>
															editTemplate(t.id, {
																testXp: Math.max(1, Number(value) || 1),
															})
														}
													/>
												</Group>
											</Stack>
										</CardLayout>
									))}
									<CardLayout>
										<Stack gap="xs">
											<Title order={5}>Add a quest</Title>
											<Group align="flex-end">
												<TextInput
													label="Id (lowercase, dashes)"
													value={newQuest.id}
													onChange={(event) =>
														setNewQuest({
															...newQuest,
															id: event.currentTarget.value,
														})
													}
												/>
												<Select
													label="Measures"
													allowDeselect={false}
													data={QUEST_METRICS.map((m) => ({
														value: m.key,
														label: m.label,
													}))}
													value={newQuest.metric}
													onChange={(value) =>
														value &&
														setNewQuest({
															...newQuest,
															metric: value as QuestTemplate["metric"],
														})
													}
												/>
												<NumberInput
													label="Target"
													min={1}
													allowDecimal={false}
													value={newQuest.target}
													onChange={(value) =>
														setNewQuest({
															...newQuest,
															target: Math.max(1, Number(value) || 1),
														})
													}
												/>
												<NumberInput
													label="XP"
													min={1}
													allowDecimal={false}
													value={newQuest.testXp}
													onChange={(value) =>
														setNewQuest({
															...newQuest,
															testXp: Math.max(1, Number(value) || 1),
														})
													}
												/>
											</Group>
											<TextInput
												label="Title"
												maxLength={100}
												value={newQuest.title}
												onChange={(event) =>
													setNewQuest({
														...newQuest,
														title: event.currentTarget.value,
													})
												}
											/>
											<TextInput
												label="Flavour line"
												maxLength={300}
												value={newQuest.flavorText}
												onChange={(event) =>
													setNewQuest({
														...newQuest,
														flavorText: event.currentTarget.value,
													})
												}
											/>
											<Textarea
												label="What the player must do"
												maxLength={500}
												autosize
												minRows={2}
												value={newQuest.description}
												onChange={(event) =>
													setNewQuest({
														...newQuest,
														description: event.currentTarget.value,
													})
												}
											/>
											<Group>
												<Button
													variant="light"
													disabled={
														!QUEST_ID_PATTERN.test(newQuest.id) ||
														templateById.has(newQuest.id) ||
														!newQuest.title.trim() ||
														!newQuest.flavorText.trim() ||
														!newQuest.description.trim()
													}
													onClick={addTemplate}
												>
													Add to catalog
												</Button>
												<Text size="xs" c="dimmed">
													It joins the catalog as an unsaved change; put it in a
													week on the Weekly calendar tab, then publish.
												</Text>
											</Group>
										</Stack>
									</CardLayout>
								</>
							)}
						</Stack>
					</Tabs.Panel>

					<Tabs.Panel value="goals" pt="md">
						<Stack gap="md">
							{overview.goals.length === 0 && (
								<CardLayout>
									<Text size="sm">No monthly goals yet. Add one below.</Text>
								</CardLayout>
							)}
							{overview.goals.map((g) => {
								const start = utcDate(g.startsAt);
								const end = utcDate(g.endsAt);
								return (
									<CardLayout key={g.goalId}>
										<Stack gap="xs">
											<Group justify="space-between" align="flex-start">
												<Stack gap={2}>
													<Group gap="sm">
														<Title order={5}>{g.title}</Title>
														<Badge
															variant="light"
															color={
																g.status === "COMPLETED"
																	? "teal"
																	: g.status === "ACTIVE"
																		? "yellow"
																		: g.status === "UPCOMING"
																			? "blue"
																			: "gray"
															}
														>
															{g.status === "COMPLETED"
																? "Completed"
																: g.status === "ACTIVE"
																	? "Open"
																	: g.status === "UPCOMING"
																		? "Upcoming"
																		: "Ended"}
														</Badge>
													</Group>
													<Text size="sm" c="dimmed">
														{g.goalId} · {start} to {end} (UTC) · +
														{g.xpEach.toLocaleString()} XP per Passport
													</Text>
													<Text size="sm">{g.flavorText}</Text>
													{g.status === "COMPLETED" && (
														<Text size="sm">
															Completed{" "}
															{new Date(g.completedAt ?? "").toLocaleString()} ·
															paid {g.recipients} Passport
															{g.recipients === 1 ? "" : "s"}
															{g.note ? ` · “${g.note}”` : ""}
														</Text>
													)}
												</Stack>
												<Group gap="xs">
													{g.status === "UPCOMING" && (
														<>
															<Button
																size="xs"
																variant="light"
																onClick={() =>
																	setGoalForm({
																		id: g.goalId,
																		title: g.title,
																		flavorText: g.flavorText,
																		startsOn: start,
																		endsOn: end,
																		xp: g.xpEach,
																		editing: true,
																	})
																}
															>
																Edit
															</Button>
															<Button
																size="xs"
																variant="subtle"
																color="red"
																disabled={busy}
																onClick={() =>
																	goalAction(
																		"remove-goal",
																		{ goalId: g.goalId },
																		() => "Goal removed.",
																	)
																}
															>
																Remove
															</Button>
														</>
													)}
													{g.status === "ACTIVE" && (
														<Button
															size="xs"
															color="teal"
															onClick={() => {
																setCompleting(
																	completing === g.goalId ? null : g.goalId,
																);
																setNote("");
																setConfirmed(false);
															}}
														>
															{completing === g.goalId
																? "Cancel"
																: "Mark complete…"}
														</Button>
													)}
												</Group>
											</Group>
											{completing === g.goalId && g.status === "ACTIVE" && (
												<Stack gap="xs">
													<Alert color="yellow" variant="light">
														This pays +{g.xpEach.toLocaleString()} XP to every
														Passport that exists right now, once. It cannot be
														undone and the goal cannot be completed again.
													</Alert>
													<TextInput
														label="Note (kept in the audit, optional)"
														maxLength={200}
														value={note}
														onChange={(event) =>
															setNote(event.currentTarget.value)
														}
													/>
													<Checkbox
														label="The goal really happened. Pay everyone."
														checked={confirmed}
														onChange={(event) =>
															setConfirmed(event.currentTarget.checked)
														}
													/>
													<Group>
														<Button
															color="teal"
															disabled={!confirmed || busy}
															loading={
																busy &&
																call.variables?.action === "complete-goal"
															}
															onClick={() =>
																goalAction(
																	"complete-goal",
																	{
																		goalId: g.goalId,
																		...(note.trim()
																			? { note: note.trim() }
																			: {}),
																	},
																	(data) => {
																		setCompleting(null);
																		const result = data.result as {
																			recipients?: number;
																		};
																		return `Completed. ${result?.recipients ?? 0} Passports were paid.`;
																	},
																)
															}
														>
															Pay everyone now (sign)
														</Button>
													</Group>
												</Stack>
											)}
										</Stack>
									</CardLayout>
								);
							})}
							<CardLayout>
								<Stack gap="xs">
									<Title order={5}>
										{goalForm.editing ? "Edit goal" : "Add a goal"}
									</Title>
									<Group align="flex-end">
										<TextInput
											label="Id (lowercase, dashes)"
											disabled={goalForm.editing}
											value={goalForm.id}
											onChange={(event) =>
												setGoalForm({
													...goalForm,
													id: event.currentTarget.value,
												})
											}
										/>
										<TextInput
											label="Opens (UTC date, YYYY-MM-DD)"
											placeholder="2026-11-01"
											value={goalForm.startsOn}
											onChange={(event) =>
												setGoalForm({
													...goalForm,
													startsOn: event.currentTarget.value,
												})
											}
										/>
										<TextInput
											label="Ends (UTC date, YYYY-MM-DD)"
											placeholder="2026-12-01"
											value={goalForm.endsOn}
											onChange={(event) =>
												setGoalForm({
													...goalForm,
													endsOn: event.currentTarget.value,
												})
											}
										/>
										<NumberInput
											label="XP per Passport"
											min={1}
											max={100000}
											allowDecimal={false}
											value={goalForm.xp}
											onChange={(value) =>
												setGoalForm({
													...goalForm,
													xp: Math.max(1, Number(value) || 1),
												})
											}
										/>
									</Group>
									<TextInput
										label="Title"
										maxLength={100}
										value={goalForm.title}
										onChange={(event) =>
											setGoalForm({
												...goalForm,
												title: event.currentTarget.value,
											})
										}
									/>
									<TextInput
										label="Flavour line"
										maxLength={300}
										value={goalForm.flavorText}
										onChange={(event) =>
											setGoalForm({
												...goalForm,
												flavorText: event.currentTarget.value,
											})
										}
									/>
									<Group>
										<Button
											disabled={!goalFormValid || busy}
											loading={busy && call.variables?.action === "save-goal"}
											onClick={saveGoal}
										>
											{goalForm.editing
												? "Save changes (sign)"
												: "Add goal (sign)"}
										</Button>
										{goalForm.editing && (
											<Button
												variant="default"
												onClick={() => setGoalForm(emptyGoal)}
											>
												Cancel edit
											</Button>
										)}
									</Group>
								</Stack>
							</CardLayout>
						</Stack>
					</Tabs.Panel>

					<Tabs.Panel value="leads" pt="md">
						<Stack gap="md">
							<CardLayout>
								<Group justify="space-between" align="center">
									<Text size="sm" c="dimmed">
										Partner leads sent by Passport holders. Marking one
										onboarded pays its scout the bounty once. Nothing is paid
										for a lead until you do.
									</Text>
									<Button
										loading={busy && call.variables?.action === "leads"}
										onClick={loadLeads}
									>
										{leads ? "Reload" : "Load leads (sign)"}
									</Button>
								</Group>
							</CardLayout>
							{leads && leads.leads.length === 0 && (
								<CardLayout>
									<Text size="sm">No leads yet.</Text>
								</CardLayout>
							)}
							{leads?.leads.map((lead) => (
								<CardLayout key={lead.leadId}>
									<Stack gap="xs">
										<Group justify="space-between" align="flex-start">
											<Stack gap={2}>
												<Group gap="sm">
													<Title order={5}>{lead.partnerName}</Title>
													<Badge
														variant="light"
														color={
															lead.status === "ONBOARDED"
																? "teal"
																: lead.status === "REJECTED"
																	? "gray"
																	: "yellow"
														}
													>
														{lead.status === "ONBOARDED"
															? "Onboarded"
															: lead.status === "REJECTED"
																? "Rejected"
																: "Needs a decision"}
													</Badge>
												</Group>
												<Text size="sm" style={{ overflowWrap: "anywhere" }}>
													<a
														href={lead.partnerUrl}
														target="_blank"
														rel="noopener noreferrer nofollow"
													>
														{lead.partnerUrl}
													</a>
												</Text>
												{lead.note && (
													<Text size="sm" style={{ overflowWrap: "anywhere" }}>
														“{lead.note}”
													</Text>
												)}
												<Text size="xs" c="dimmed">
													Scout{" "}
													{lead.scoutWallet
														? formatAddress(lead.scoutWallet)
														: `Passport ${lead.passportId.slice(0, 8)}`}{" "}
													· sent {new Date(lead.submittedAt).toLocaleString()}
													{lead.decidedAt
														? ` · decided ${new Date(lead.decidedAt).toLocaleString()}`
														: ""}
													{lead.adminNote ? ` · “${lead.adminNote}”` : ""}
												</Text>
											</Stack>
											{lead.status === "SUBMITTED" && (
												<Group gap="xs">
													<Button
														size="xs"
														color="teal"
														onClick={() => {
															setDeciding(
																deciding?.id === lead.leadId &&
																	deciding.kind === "onboard"
																	? null
																	: { id: lead.leadId, kind: "onboard" },
															);
															setLeadNote("");
															setLeadConfirmed(false);
														}}
													>
														Onboarded…
													</Button>
													<Button
														size="xs"
														variant="subtle"
														color="red"
														onClick={() => {
															setDeciding(
																deciding?.id === lead.leadId &&
																	deciding.kind === "reject"
																	? null
																	: { id: lead.leadId, kind: "reject" },
															);
															setLeadNote("");
															setLeadConfirmed(false);
														}}
													>
														Reject…
													</Button>
												</Group>
											)}
										</Group>
										{deciding?.id === lead.leadId &&
											lead.status === "SUBMITTED" && (
												<Stack gap="xs">
													{deciding.kind === "onboard" ? (
														<Alert color="yellow" variant="light">
															This pays the scout +
															{leads.bountyXp.toLocaleString()} XP, once, and
															cannot be undone. It does not complete the monthly
															goal; do that on the Monthly goals tab.
														</Alert>
													) : (
														<Alert color="gray" variant="light">
															The scout sees your note. Use it to say why, for
															example that the project is already in the
															pipeline.
														</Alert>
													)}
													<TextInput
														label="Note (optional, kept in the audit)"
														maxLength={200}
														value={leadNote}
														onChange={(event) =>
															setLeadNote(event.currentTarget.value)
														}
													/>
													{deciding.kind === "onboard" && (
														<Checkbox
															label="The partner is really onboarded. Pay the scout."
															checked={leadConfirmed}
															onChange={(event) =>
																setLeadConfirmed(event.currentTarget.checked)
															}
														/>
													)}
													<Group>
														<Button
															color={
																deciding.kind === "onboard" ? "teal" : "red"
															}
															disabled={
																busy ||
																(deciding.kind === "onboard" && !leadConfirmed)
															}
															loading={
																busy &&
																(call.variables?.action === "onboard-lead" ||
																	call.variables?.action === "reject-lead")
															}
															onClick={() =>
																decideLead(deciding.kind, lead.leadId)
															}
														>
															{deciding.kind === "onboard"
																? "Pay the scout (sign)"
																: "Reject lead (sign)"}
														</Button>
													</Group>
												</Stack>
											)}
									</Stack>
								</CardLayout>
							))}
						</Stack>
					</Tabs.Panel>
				</Tabs>
			)}
		</Stack>
	);
};
