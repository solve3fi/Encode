"use client";

import { useEffect, useState } from "react";
import { useQuestSession } from "./QuestSessionProvider";
import styles from "./ReferralCard.module.css";
import { SocialPostComposer } from "./SocialPostComposer";

type SocialKey = "follow-x" | "post-x" | "join-discord";
type SocialQuest = {
	key: SocialKey;
	title: string;
	description: string;
	xp: number;
	actionLabel: string;
	actionUrl: string;
	postText: string | null;
	claimedAt: string | null;
};
type SocialClient = {
	socialClaim: (
		quest: SocialKey,
	) => Promise<{ result: "OK" | "ALREADY"; social: SocialQuest[] }>;
};

/** Seconds a player has after opening the link before the claim unlocks, so the claim is not a blind click. */
const UNLOCK_SECONDS = 10;

/** Plain wording for the follow quest, whatever the stored rule text says (rules are immutable in the database). */
const FOLLOW_COPY = {
	title: "Follow Solve3fi",
	description: `Follow @solve3fi on X, then come back and claim. The claim unlocks ${UNLOCK_SECONDS} seconds after you open X.`,
	actionLabel: "Follow Solve3fi",
};

/**
 * Social quests: follow Solve3 on X, send the prewritten post, join the Discord. One time each. X and Discord cannot be
 * checked from the chain, so these are honor claims for a small amount of XP, recorded so the team can spot-check them.
 */
export function SocialQuestsCard() {
	const { client, state } = useQuestSession();
	const view = state as {
		status: string;
		xp?: { social?: SocialQuest[] | null } | null;
	};
	const ready = view.status === "READY";
	const api = client as unknown as SocialClient | undefined;
	const [override, setOverride] = useState<SocialQuest[] | null>(null);
	const [openedAt, setOpenedAt] = useState<Partial<Record<SocialKey, number>>>(
		{},
	);
	const [now, setNow] = useState(() => Date.now());
	const [busy, setBusy] = useState<SocialKey | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		if (Object.keys(openedAt).length === 0) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [openedAt]);

	if (!process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN) return null;
	const quests = override ?? view.xp?.social ?? null;
	// Nothing to show until the server has sent the section (older backends omit it).
	if (ready && (!quests || quests.length === 0)) return null;

	const open = (quest: SocialQuest) => {
		window.open(quest.actionUrl, "_blank", "noopener,noreferrer");
		setOpenedAt((current) => ({ ...current, [quest.key]: Date.now() }));
		setNow(Date.now());
	};
	const claim = async (quest: SocialQuest) => {
		if (!api || busy) return;
		setBusy(quest.key);
		setMessage(null);
		try {
			const out = await api.socialClaim(quest.key);
			setOverride(out.social);
		} catch {
			setMessage("Could not claim that right now. Try again in a moment.");
		} finally {
			setBusy(null);
		}
	};

	return (
		<section className={styles.card} aria-label="Social quests">
			<div className={styles.head}>
				<div>
					<span className={styles.eyebrow}>One-time quests</span>
					<h3>Spread the word</h3>
				</div>
			</div>
			{!ready || !quests ? (
				<>
					<p className={styles.muted}>
						Follow @solve3fi and share a post on X. Sign in to track and claim
						your one-time quests.
					</p>
					<a
						href="https://x.com/solve3fi"
						target="_blank"
						rel="noopener noreferrer"
						className={styles.cta}
						style={{
							alignSelf: "flex-start",
							display: "inline-flex",
							alignItems: "center",
						}}
					>
						Follow Solve3fi
					</a>
					<SocialPostComposer />
				</>
			) : (
				<div className={styles.grid}>
					{quests.map((quest) => {
						const opened = openedAt[quest.key];
						const wait =
							opened === undefined
								? null
								: Math.max(
										0,
										UNLOCK_SECONDS - Math.floor((now - opened) / 1000),
									);
						const done = quest.claimedAt !== null;
						return (
							<div className={styles.block} key={quest.key}>
								<span className={styles.label}>
									+{quest.xp.toLocaleString()} XP
								</span>
								<strong>
									{quest.key === "follow-x" ? FOLLOW_COPY.title : quest.title}
								</strong>
								<p className={styles.muted}>
									{quest.key === "follow-x"
										? FOLLOW_COPY.description
										: quest.description}
								</p>
								{quest.key === "post-x" && !done && (
									<SocialPostComposer
										onOpened={() => {
											setOpenedAt((current) => ({
												...current,
												[quest.key]: Date.now(),
											}));
											setNow(Date.now());
										}}
									/>
								)}
								{done ? (
									<p className={styles.note}>
										Claimed. The system is pleased. Mostly.
									</p>
								) : (
									<div className={styles.row}>
										{quest.key !== "post-x" && (
											<button
												type="button"
												className={styles.cta}
												onClick={() => open(quest)}
											>
												{quest.key === "follow-x"
													? FOLLOW_COPY.actionLabel
													: quest.actionLabel}
											</button>
										)}
										<button
											type="button"
											className={styles.cta}
											disabled={wait === null || wait > 0 || busy !== null}
											onClick={() => void claim(quest)}
										>
											{wait !== null && wait > 0
												? `Claim in ${wait}s`
												: busy === quest.key
													? "Claiming…"
													: "Claim XP"}
										</button>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
			<p className={styles.muted}>
				Social quests are one-time, self-reported Devnet claims and may be
				spot-checked. Copying or opening X does not verify a follow or post.
			</p>
			{message && (
				<p role="status" className={styles.note}>
					{message}
				</p>
			)}
		</section>
	);
}
