"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { useQuestSession } from "./QuestSessionProvider";
import styles from "./QuestTest.module.css";

type Quest = {
	instanceKey: string;
	title: string;
	flavorText: string;
	description: string;
	target: number;
	progress: number | null;
	testXp: number;
	status: string;
};
type Goal = {
	id: string;
	title: string;
	state: string;
	targetUsdCents: string;
	testXp: number;
	endsAt: string;
};
type Receipt = {
	completionKey: string;
	testXp: number;
	startsAt: string;
	slot: number;
	expired: boolean;
	recordedAt: string;
};
type Onboarding = {
	id: string;
	title: string;
	description: string;
	xp: number;
	completed: boolean;
	awardedAt: string | null;
};
type CommunityGoal = {
	id: string;
	title: string;
	flavorText: string;
	startsAt: string;
	endsAt: string;
	xp: number;
	status: "UPCOMING" | "ACTIVE" | "EXPIRED" | "COMPLETED";
	completedAt: string | null;
	received: boolean;
};
type State = {
	status: string;
	xp: {
		totalXp: number;
		onboarding: Onboarding[];
		community?: CommunityGoal[];
	} | null;
	error: string | null;
	snapshot: {
		weekly: { quests: Quest[]; expiresAt: string } | null;
		communityGoals: Goal[];
		milestones: {
			goalId: string;
			observedTvlUsdCents: string;
			entitlement: { testXp: number } | null;
		}[];
	} | null;
	history: { receipts: Receipt[]; nextCursor: object | null } | null;
};
const errors: Record<string, string> = {
	UNAUTHORIZED:
		"Wallet verification failed. Reconnect or retry the sign-in message.",
	FORBIDDEN: "Your session or link is no longer valid. Sign in again.",
	RATE_LIMITED: "Too many requests. Wait a moment and try again.",
	UNAVAILABLE:
		"Progress unavailable. Your activity has not been replaced with zero.",
};

// Weekly cards cycle through the design's accent colours and glyphs.
const ACCENTS = [
	{ color: "#58d7ff", bg: "rgba(88,215,255,0.14)", glyph: "⇄" },
	{ color: "#8c84ff", bg: "rgba(140,132,255,0.16)", glyph: "◐" },
	{ color: "#f5b14c", bg: "rgba(245,177,76,0.14)", glyph: "✦" },
] as const;

const statusText = (status: string) =>
	status
		.replaceAll("_", " ")
		.toLowerCase()
		.replace(/^./, (c) => c.toUpperCase());

const dateOnly = (iso: string) => iso.slice(0, 10);

function Countdown({ endsAt }: { endsAt: string }) {
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(id);
	}, []);
	if (now === null) return <>Resets soon</>;
	const ms = Math.max(0, Date.parse(endsAt) - now);
	const days = Math.floor(ms / 86_400_000);
	const hours = Math.floor((ms % 86_400_000) / 3_600_000);
	const minutes = Math.floor((ms % 3_600_000) / 60_000);
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		<>
			Resets in {days}d {pad(hours)}:{pad(minutes)}
		</>
	);
}

export function QuestTestPanel({
	historyOnly = false,
}: {
	historyOnly?: boolean;
}) {
	const { client, state, wallet, network, signMessage } = useQuestSession();
	const { setOpenModal } = useModalActions();
	const view = state as State;
	const campaign = process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN;
	if (!campaign) return null;
	const busy = ["SIGNING", "LOADING"].includes(view.status);
	const ready = view.status === "READY";
	const weekly = view.snapshot?.weekly ?? null;
	const onboarding = view.xp?.onboarding ?? [];
	const mint = onboarding.find((q) => q.id === "mint-pass");
	const connect = onboarding.find((q) => q.id === "connect-wallet");
	const doneCount = [connect, mint].filter((q) => q?.completed).length;
	const goal = view.snapshot?.communityGoals.find((g) => g.state === "ACTIVE");
	// Goals a person completes by hand (for example "Get a partner onboarded"): shown while open or just decided.
	const manualGoals = (view.xp?.community ?? []).filter(
		(g) => g.status !== "EXPIRED" || g.completedAt !== null,
	);
	const reached = goal
		? view.snapshot?.milestones.find((m) => m.goalId === goal.id)
		: undefined;
	const goalTarget = goal ? Number(goal.targetUsdCents) / 100 : null;
	const goalTotal = reached ? Number(reached.observedTvlUsdCents) / 100 : null;
	const goalPercent =
		goalTarget && goalTotal !== null
			? Math.min(100, Math.max(0, (goalTotal / goalTarget) * 100))
			: null;
	const money = (value: number) =>
		`$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
	const short = (value: number) =>
		value >= 1_000_000
			? `$${value / 1_000_000}M`
			: value >= 1_000
				? `$${Math.round(value / 1_000)}K`
				: `$${value}`;

	return (
		<section className={styles.panel} aria-label="Weekly quests">
			<p className={styles.muted}>
				Devnet Preseason: XP, levels and quest progress reset at Genesis.
				Your verified Solve3 Pass, Mint Pass completion and 250 XP are preserved.
			</p>
			<div className={styles.head}>
				<div className={styles.headText}>
					<span className={styles.eyebrow}>
						{historyOnly ? "Your history" : "This epoch"}
					</span>
					<h2>{historyOnly ? "Earned XP" : "Your weekly quests"}</h2>
					{!historyOnly && (
						<p>
							Quick wins that refresh every epoch. Three weekly quests expire
							Thursday at 00:00 UTC. Community goals run on their own monthly
							windows. XP is credited after on-chain verification.
						</p>
					)}
				</div>
				{!historyOnly && (
					<div className={styles.headActions}>
						{weekly && (
							<span className={styles.chip} data-tone="amber">
								<i />
								<Countdown endsAt={weekly.expiresAt} />
							</span>
						)}
						{wallet && network === "devnet" && (
							<>
								<button
									type="button"
									className={styles.ghost}
									disabled={busy || !ready}
									onClick={() => void client?.refresh()}
								>
									Refresh progress
								</button>
								{!ready && !busy && (
									<button
										type="button"
										className={styles.ghost}
										disabled={!signMessage}
										onClick={() => void client?.signIn(signMessage)}
									>
										Retry wallet sign-in
									</button>
								)}
								{ready && (
									<button
										type="button"
										className={styles.ghost}
										onClick={() => void client?.logout()}
									>
										Sign out
									</button>
								)}
							</>
						)}
					</div>
				)}
			</div>

			{!wallet ? (
				<p role="status" className={styles.note}>
					Connect your wallet to see your progress.
				</p>
			) : network !== "devnet" ? (
				<p role="status" className={styles.note}>
					Switch to Devnet to see your quest progress.
				</p>
			) : null}
			{wallet && network === "devnet" && !signMessage && (
				<p className={styles.note}>
					This wallet does not support message signing.
				</p>
			)}
			{busy && (
				<p role="status" className={styles.note}>
					{view.status === "SIGNING"
						? "Approve the Passport sign-in message in your wallet."
						: "Loading your progress…"}
				</p>
			)}
			{view.error && (
				<p role="alert" className={styles.alert}>
					{errors[view.error] ?? errors.UNAVAILABLE}
				</p>
			)}

			{!historyOnly && (
				<div className={styles.block}>
					<div className={styles.row}>
						<h3>Get started</h3>
						<span className={styles.muted}>
							{doneCount} of 2 done · Your XP{" "}
							<b className={styles.amber}>
								{view.xp ? view.xp.totalXp.toLocaleString() : "—"}
							</b>
						</span>
					</div>
					<div className={styles.two}>
						<div
							className={styles.step}
							data-done={connect?.completed ? "true" : undefined}
						>
							<span
								className={styles.num}
								data-done={connect?.completed ? "true" : undefined}
							>
								{connect?.completed ? "✓" : "1"}
							</span>
							<div className={styles.stepBody}>
								<strong>Connect your wallet</strong>
								<span>
									Sign in once with your wallet to prove you own it. Counts once
									per Passport.
								</span>
								<div className={styles.row}>
									<span className={styles.xp}>
										+{(connect?.xp ?? 100).toLocaleString()} XP
									</span>
									{connect?.completed ? (
										<span className={styles.done}>
											Done
											{connect.awardedAt
												? ` · ${dateOnly(connect.awardedAt)}`
												: ""}
										</span>
									) : !wallet ? (
										<button
											type="button"
											className={styles.cta}
											onClick={() => setOpenModal(ModalType.WALLET)}
										>
											Connect wallet
										</button>
									) : null}
								</div>
							</div>
						</div>
						<div
							className={styles.step}
							data-done={mint?.completed ? "true" : undefined}
						>
							<span
								className={styles.num}
								data-tone="violet"
								data-done={mint?.completed ? "true" : undefined}
							>
								{mint?.completed ? "✓" : "2"}
							</span>
							<div className={styles.stepBody}>
								<strong>Mint your Solve3 Pass</strong>
								<span>
									Mint your free Pass. Counts once per Passport, after the mint
									is confirmed on-chain.
								</span>
								<div className={styles.row}>
									<span className={styles.xp}>
										+{(mint?.xp ?? 250).toLocaleString()} XP
									</span>
									{mint?.completed ? (
										<span className={styles.done}>
											Done
											{mint.awardedAt ? ` · ${dateOnly(mint.awardedAt)}` : ""}
										</span>
									) : (
										<Link href="/quests?tab=pass" className={styles.cta}>
											Mint your Pass →
										</Link>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			)}

			{!historyOnly && (
				<div className={styles.block}>
					<div className={styles.row}>
						<h3>Weekly quests</h3>
						<span className={styles.muted}>
							Expires <b>Thursday 00:00 UTC</b>
						</span>
					</div>
					{weekly ? (
						<div className={styles.three}>
							{weekly.quests.map((q, index) => {
								const accent = ACCENTS[index % ACCENTS.length];
								const unavailable = q.progress === null;
								const shown = unavailable
									? 0
									: Math.min(q.progress ?? 0, q.target);
								return (
									<article
										key={q.instanceKey}
										className={styles.qcard}
										style={{ borderTopColor: accent.color }}
									>
										<div className={styles.row}>
											<span
												className={styles.glyph}
												style={{ color: accent.color, background: accent.bg }}
											>
												{accent.glyph}
											</span>
											<span
												className={styles.xp}
												style={{ color: accent.color, background: accent.bg }}
											>
												+{q.testXp.toLocaleString()} XP
											</span>
										</div>
										<div className={styles.qtext}>
											<h4>{q.title}</h4>
											<p>{q.flavorText}</p>
										</div>
										<p className={styles.goal}>
											<span>Goal · </span>
											{q.description}
										</p>
										<div className={styles.progress}>
											<div className={styles.bar}>
												<div
													className={styles.fill}
													style={{
														width: `${(shown / q.target) * 100}%`,
														background: accent.color,
													}}
												/>
												{q.target > 1 && (
													<div
														className={styles.gaps}
														style={{
															backgroundImage: `repeating-linear-gradient(90deg,transparent 0,transparent calc(100% / ${q.target} - 3px),#141428 calc(100% / ${q.target} - 3px),#141428 calc(100% / ${q.target}))`,
														}}
													/>
												)}
											</div>
											<div className={styles.row}>
												<strong>
													{unavailable
														? "Progress unavailable"
														: `${shown} / ${q.target}`}
												</strong>
												<span className={styles.muted}>
													{unavailable ? "" : statusText(q.status)}
												</span>
											</div>
										</div>
									</article>
								);
							})}
						</div>
					) : (
						<p className={styles.note}>
							{view.snapshot
								? "No weekly set is active."
								: "Progress unavailable"}
						</p>
					)}
				</div>
			)}

			{!historyOnly && (
				<div className={styles.block}>
					<div className={styles.row}>
						<h3>Monthly community goals</h3>
						{goal && (
							<span className={styles.muted}>
								Ends{" "}
								<b className={styles.amber}>
									{dateOnly(goal.endsAt)} 00:00 UTC
								</b>
							</span>
						)}
					</div>
					{goal ? (
						<article className={styles.goalCard}>
							<div className={styles.goalTop}>
								<div className={styles.goalText}>
									<span className={styles.eyebrow} data-tone="amber">
										Everyone contributes
									</span>
									<h4>{goal.title}</h4>
									<p>
										Hit the community target together and every eligible
										Passport earns the reward. No one has to carry the whole
										thing.
									</p>
								</div>
								<div className={styles.reward}>
									<span>Reward per eligible Passport</span>
									<b>+{goal.testXp.toLocaleString()} XP</b>
								</div>
							</div>
							<div className={styles.goalBar}>
								<div className={styles.row}>
									<span className={styles.goalTotal}>
										<b className={styles.amber}>
											{goalTotal === null
												? "Progress unavailable"
												: money(goalTotal)}
										</b>{" "}
										<span className={styles.muted}>
											of {goalTarget === null ? "—" : money(goalTarget)} target
										</span>
									</span>
									<span className={styles.muted}>
										{goalPercent === null
											? ""
											: goalPercent >= 100
												? "Reached"
												: "Not reached yet"}
									</span>
								</div>
								<div className={styles.track}>
									<div
										className={styles.trackFill}
										style={{ width: `${goalPercent ?? 0}%` }}
									/>
									{[25, 50, 75].map((p) => (
										<span
											key={p}
											className={styles.tick}
											style={{ left: `${p}%` }}
										/>
									))}
								</div>
								{goalTarget !== null && (
									<div className={styles.scale}>
										{[0, 0.25, 0.5, 0.75, 1].map((f) => (
											<span key={f}>{short(goalTarget * f)}</span>
										))}
									</div>
								)}
								{reached?.entitlement && (
									<p className={styles.note}>
										{reached.entitlement.testXp.toLocaleString()} XP reserved
										for your Passport.
									</p>
								)}
							</div>
						</article>
					) : manualGoals.length === 0 ? (
						<p className={styles.note}>
							{view.snapshot
								? "No community goal is active."
								: "Progress unavailable"}
						</p>
					) : null}
					{manualGoals.map((g) => (
						<article key={g.id} className={styles.goalCard}>
							<div className={styles.goalTop}>
								<div className={styles.goalText}>
									<span
										className={styles.eyebrow}
										data-tone={g.status === "COMPLETED" ? "green" : "amber"}
									>
										{g.status === "COMPLETED"
											? "Completed"
											: g.status === "UPCOMING"
												? `Starts ${dateOnly(g.startsAt)}`
												: "Everyone contributes"}
									</span>
									<h4>{g.title}</h4>
									<p>{g.flavorText}</p>
								</div>
								<div className={styles.reward}>
									<span>Reward per Passport</span>
									<b>+{g.xp.toLocaleString()} XP</b>
								</div>
							</div>
							<p className={styles.note}>
								{g.status === "COMPLETED"
									? g.received
										? `You received +${g.xp.toLocaleString()} XP.`
										: "Completed before your Passport existed, so it did not pay you."
									: g.status === "ACTIVE"
										? `The Solve3 team marks this complete when it happens, and every Passport is paid at that moment. Ends ${dateOnly(g.endsAt)} 00:00 UTC.`
										: "Opens at the start of its month."}
							</p>
						</article>
					))}
				</div>
			)}

			<div className={styles.block}>
				<div className={styles.row}>
					<h3>Earned XP receipts</h3>
					<span className={styles.muted}>Verified on-chain</span>
				</div>
				{view.history && view.history.receipts.length > 0 ? (
					<ul className={styles.receipts}>
						{view.history.receipts.map((r) => (
							<li key={r.completionKey}>
								<strong>+{r.testXp.toLocaleString()} XP</strong>
								<span>
									Week of {dateOnly(r.startsAt)} · quest {r.slot + 1}
									{r.expired ? " · expired quest, receipt retained" : ""}
								</span>
								<span className={styles.muted}>{dateOnly(r.recordedAt)}</span>
							</li>
						))}
					</ul>
				) : (
					<div className={styles.empty}>
						<span className={styles.flag}>⚑</span>
						<div>
							<strong>
								{view.history
									? "No receipts for this Passport yet"
									: "Receipts unavailable"}
							</strong>
							<span>
								Complete a quest above and its receipt appears here with the
								quest, the XP and the date it was credited.
							</span>
						</div>
						<div className={styles.chips}>
							<span className={styles.chip}>Quest</span>
							<span className={styles.chip}>XP</span>
							<span className={styles.chip}>Date</span>
						</div>
					</div>
				)}
				{view.history?.nextCursor && (
					<button
						type="button"
						className={styles.ghost}
						disabled={busy}
						onClick={() => void client?.more()}
					>
						Load older receipts
					</button>
				)}
			</div>
		</section>
	);
}
