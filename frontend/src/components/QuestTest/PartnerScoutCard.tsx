"use client";

import { useState } from "react";
import { useQuestSession } from "./QuestSessionProvider";
import styles from "./ReferralCard.module.css";

type Lead = {
	name: string;
	url: string;
	status: "SUBMITTED" | "REJECTED" | "ONBOARDED";
	submittedAt: string;
	note: string | null;
};
type Scout = {
	bountyXp: number;
	weeklyLimit: number;
	remainingThisWeek: number;
	leads: Lead[];
};
type ScoutClient = {
	partnerLead: (input: {
		name: string;
		url: string;
		note: string;
	}) => Promise<{ result: "OK" | "DUPLICATE"; partnerScout: Scout }>;
};

const STATUS: Record<Lead["status"], string> = {
	SUBMITTED: "Under review",
	REJECTED: "Not taken forward",
	ONBOARDED: "Onboarded",
};

/** People paste "their-site.example" without the scheme; add https:// so a plain domain is accepted. */
const withScheme = (value: string) => {
	const trimmed = value.trim();
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};
const looksLikeWebAddress = (value: string) => {
	const full = withScheme(value);
	return /^https?:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(full) && full.length <= 200;
};

/**
 * Partner Scout: send us a project Solve3 should onboard. XP is paid only if the team onboards it, so a lead earns
 * nothing until then. The first valid lead for a partner wins.
 */
export function PartnerScoutCard() {
	const { client, state } = useQuestSession();
	const view = state as {
		status: string;
		xp?: { partnerScout?: Scout | null } | null;
	};
	const ready = view.status === "READY";
	const api = client as unknown as ScoutClient | undefined;
	const [override, setOverride] = useState<Scout | null>(null);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [note, setNote] = useState("");
	const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(
		null,
	);
	const [busy, setBusy] = useState(false);

	if (!process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN) return null;
	const scout = override ?? view.xp?.partnerScout ?? null;
	// Nothing to show until the server has sent the section (older backends omit it).
	if (ready && !scout) return null;

	const valid =
		name.trim().length >= 2 &&
		name.trim().length <= 80 &&
		looksLikeWebAddress(url);
	const canSend =
		ready && valid && !busy && (scout?.remainingThisWeek ?? 0) > 0;

	const send = async () => {
		if (!api || !canSend) return;
		setBusy(true);
		setMessage(null);
		try {
			const out = await api.partnerLead({
				name: name.trim(),
				url: withScheme(url),
				note,
			});
			setOverride(out.partnerScout);
			if (out.result === "OK") {
				setName("");
				setUrl("");
				setNote("");
				setMessage({
					text: "Thanks. The team will review it. You are paid when the partner is onboarded.",
					bad: false,
				});
			} else {
				setMessage({
					text: "We already have a lead for that project, so it was not added.",
					bad: true,
				});
			}
		} catch (error) {
			setMessage({
				text:
					error instanceof Error && error.message === "RATE_LIMITED"
						? "You have used this week's leads. Try again next week."
						: "Could not send that right now. Check the link and try again.",
				bad: true,
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className={styles.card} aria-label="Partner Scout">
			<div className={styles.head}>
				<div>
					<span className={styles.eyebrow}>Partner Scout</span>
					<h3>Bring us a partner</h3>
				</div>
				{scout && (
					<span className={styles.rate}>
						+{scout.bountyXp.toLocaleString()} XP when onboarded
					</span>
				)}
			</div>
			{!ready ? (
				<p className={styles.muted}>
					Connect and sign in to send a lead for a project you think we should
					onboard.
				</p>
			) : (
				<div className={styles.grid}>
					<div className={styles.block}>
						<span className={styles.label}>Send a lead</span>
						<input
							className={styles.input}
							value={name}
							maxLength={80}
							placeholder="Project name"
							aria-label="Project name"
							onChange={(event) => setName(event.target.value)}
						/>
						<input
							className={styles.input}
							value={url}
							maxLength={200}
							placeholder="https://their-site.example"
							aria-label="Project link"
							inputMode="url"
							onChange={(event) => setUrl(event.target.value)}
						/>
						<input
							className={styles.input}
							value={note}
							maxLength={300}
							placeholder="Why would they be a good partner? (optional)"
							aria-label="Note"
							onChange={(event) => setNote(event.target.value)}
						/>
						<div className={styles.row}>
							<button
								type="button"
								className={styles.cta}
								disabled={!canSend}
								onClick={() => void send()}
							>
								Send lead
							</button>
							<span className={styles.muted}>
								{!valid
									? "Enter the project name and its website to send."
									: scout
										? `${scout.remainingThisWeek} of ${scout.weeklyLimit} left this week`
										: ""}
							</span>
						</div>
						<p className={styles.muted}>
							You earn nothing for sending a lead, only when the team onboards
							the partner. The first lead for a project wins.
						</p>
						{message && (
							<p role="status" className={styles.note}>
								{message.text}
							</p>
						)}
					</div>
					<div className={styles.block}>
						<span className={styles.label}>Your leads</span>
						{scout && scout.leads.length > 0 ? (
							<ul
								style={{
									listStyle: "none",
									margin: 0,
									padding: 0,
									display: "flex",
									flexDirection: "column",
									gap: 10,
								}}
							>
								{scout.leads.map((lead) => (
									<li
										key={`${lead.url}-${lead.submittedAt}`}
										style={{ overflowWrap: "anywhere" }}
									>
										<strong>{lead.name}</strong>
										<div className={styles.muted}>
											{STATUS[lead.status]}
											{lead.status === "ONBOARDED" && scout
												? ` · +${scout.bountyXp.toLocaleString()} XP`
												: ""}
											{lead.status === "REJECTED" && lead.note
												? ` · ${lead.note}`
												: ""}
										</div>
									</li>
								))}
							</ul>
						) : (
							<p className={styles.muted}>No leads yet.</p>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
