"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PassMintButton } from "@/components/QuestTest/PassMintButton";
import { SocialPostComposer } from "@/components/QuestTest/SocialPostComposer";
import { useQuestSession } from "@/components/QuestTest/QuestSessionProvider";
import { ConnectButton } from "@/components/Wallet/ConnectButton";
import { LAUNCH_POOLS_ANCHOR } from "@/configs/genesis";
import styles from "./LaunchQuests.module.css";

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
type Onboarding = {
	id: string;
	xp: number;
	completed: boolean;
	description?: string;
};
type WeeklyQuest = {
	instanceKey: string;
	description: string;
	target: number;
	progress: number | null;
	testXp: number;
};
type View = {
	status: string;
	xp?: {
		totalXp?: number;
		onboarding?: Onboarding[];
		social?: SocialQuest[] | null;
	} | null;
	snapshot?: { weekly?: { quests: WeeklyQuest[] } | null } | null;
};
type QuestApi = {
	connect: (
		sign: (message: Uint8Array) => Promise<Uint8Array>,
	) => Promise<unknown>;
	socialClaim: (
		quest: SocialKey,
	) => Promise<{ result: "OK" | "ALREADY"; social: SocialQuest[] }>;
};

/** Seconds after opening an X or Discord link before its claim unlocks (same rule as the Quests page). */
const UNLOCK_SECONDS = 10;

const isLiquidityQuest = (quest: WeeklyQuest) =>
	quest.instanceKey.includes("featured-pool") ||
	/liquidity/i.test(quest.description);

/**
 * Soft-launch funnel on the Genesis page: mint the Solve3 Pass, join the Discord, post on X, add liquidity.
 * Each step pays quest XP through the existing quest backend (one sign-in for all of them). X and Discord are honour
 * claims that unlock a few seconds after the link is opened; liquidity counts through the weekly LP quest when one is live.
 */
export function LaunchQuests() {
	const { client, state, wallet, network, signMessage } = useQuestSession();
	const { connected } = useWallet();
	const view = state as View;
	const api = client as unknown as QuestApi | null;
	const ready = view.status === "READY";
	const signingIn = view.status === "LOADING" || view.status === "SIGNING";
	const [social, setSocial] = useState<SocialQuest[] | null>(null);
	const [openedAt, setOpenedAt] = useState<Partial<Record<SocialKey, number>>>(
		{},
	);
	const [now, setNow] = useState(() => Date.now());
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	// A different wallet or network starts from the server's view again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: identity changes reset local claim state.
	useEffect(() => {
		setSocial(null);
		setOpenedAt({});
		setMessage(null);
	}, [wallet, network]);
	useEffect(() => {
		if (Object.keys(openedAt).length === 0) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [openedAt]);

	if (!process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN) return null;

	const socialQuests = social ?? view.xp?.social ?? [];
	const discord = socialQuests.find((quest) => quest.key === "join-discord");
	const post = socialQuests.find((quest) => quest.key === "post-x");
	const follow = socialQuests.find((quest) => quest.key === "follow-x");
	const pass = view.xp?.onboarding?.find((quest) => quest.id === "mint-pass");
	// The one-time add-liquidity quest (migration 033); the weekly liquidity quest, when live, pays on top.
	const addLiquidity = view.xp?.onboarding?.find(
		(quest) => quest.id === "add-liquidity",
	);
	const lp = view.snapshot?.weekly?.quests.find(isLiquidityQuest);
	const weeklyLpDone = Boolean(
		lp && lp.progress !== null && lp.progress >= lp.target,
	);
	const lpDone = Boolean(addLiquidity?.completed);

	const steps = [
		pass?.completed,
		discord?.claimedAt,
		follow?.claimedAt,
		post?.claimedAt,
		lpDone,
	];
	const done = ready ? steps.filter(Boolean).length : 0;
	const xpOnOffer =
		(pass?.xp ?? 250) +
		(discord?.xp ?? 100) +
		(follow?.xp ?? 100) +
		(post?.xp ?? 100) +
		(addLiquidity?.xp ?? 300);

	const signIn = async () => {
		if (!api || !signMessage || busy) return;
		setBusy("sign-in");
		setMessage(null);
		try {
			await api.connect((bytes) => signMessage(bytes));
		} catch {
			setMessage(
				"Sign-in was not completed. Approve the message in your wallet to start.",
			);
		} finally {
			setBusy(null);
		}
	};
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
			setSocial((await api.socialClaim(quest.key)).social);
		} catch {
			setMessage("Could not claim that right now. Try again in a moment.");
		} finally {
			setBusy(null);
		}
	};

	const socialAction = (
		quest: SocialQuest | undefined,
		fallbackLabel: string,
		forcedLabel?: string,
	) => {
		if (!quest) return <span className={styles.muted}>Sign in to unlock</span>;
		if (quest.claimedAt) return <span className={styles.done}>Claimed</span>;
		const opened = openedAt[quest.key];
		const wait =
			opened === undefined
				? null
				: Math.max(0, UNLOCK_SECONDS - Math.floor((now - opened) / 1000));
		return (
			<div className={styles.actions}>
				{quest.key !== "post-x" && (
					<button
						type="button"
						className={styles.cta}
						onClick={() => open(quest)}
					>
						{forcedLabel ?? (quest.actionLabel || fallbackLabel)}
					</button>
				)}
				<button
					type="button"
					className={styles.secondary}
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
		);
	};

	return (
		<section className={styles.section} aria-labelledby="launch-quests-title">
			<div className={styles.header}>
				<div>
					<p className={styles.eyebrow}>Start here</p>
					<h2 id="launch-quests-title">
						Earn your first {xpOnOffer.toLocaleString()} XP
					</h2>
					<p className={styles.lead}>
						Five quick steps to get on the board before Genesis opens. XP feeds
						your Solve3 Pass and the launch leaderboard.
					</p>
				</div>
				<div className={styles.progress}>
					<strong>{done}/5</strong>
					<span>steps done</span>
				</div>
			</div>

			{!connected ? (
				<div className={styles.gate}>
					<p>Connect a wallet to start earning XP.</p>
					<ConnectButton />
				</div>
			) : network !== "devnet" ? (
				<div className={styles.gate}>
					<p>
						Quests run on Solana devnet during the soft launch. Switch your
						network to devnet.
					</p>
				</div>
			) : !ready ? (
				<div className={styles.gate}>
					<p>
						Sign one message to prove the wallet is yours. It costs nothing and
						sends no transaction.
					</p>
					<button
						type="button"
						className={styles.cta}
						disabled={!api || !signMessage || busy !== null || signingIn}
						onClick={() => void signIn()}
					>
						{busy === "sign-in" || signingIn
							? "Waiting for your wallet…"
							: "Start quests"}
					</button>
				</div>
			) : null}

			<ol className={styles.steps}>
				<li className={pass?.completed ? styles.stepDone : styles.step}>
					<div className={styles.stepHead}>
						<span className={styles.index}>1</span>
						<span className={styles.xp}>
							+{(pass?.xp ?? 250).toLocaleString()} XP
						</span>
					</div>
					<h3>Mint your Solve3 Pass</h3>
					<p className={styles.muted}>
						Your free, non-transferable Pass. It carries your XP and launch
						status.
					</p>
					{pass?.completed ? (
						<span className={styles.done}>Minted</span>
					) : ready ? (
						<div className={styles.passMint}>
							<PassMintButton className={styles.cta} />
						</div>
					) : (
						<span className={styles.muted}>Sign in to unlock</span>
					)}
				</li>

				<li className={discord?.claimedAt ? styles.stepDone : styles.step}>
					<div className={styles.stepHead}>
						<span className={styles.index}>2</span>
						<span className={styles.xp}>
							+{(discord?.xp ?? 100).toLocaleString()} XP
						</span>
					</div>
					<h3>Join the Discord</h3>
					<p className={styles.muted}>
						Launch news, pool announcements and the people building Solve3.
					</p>
					{socialAction(ready ? discord : undefined, "Join Discord")}
				</li>

				<li className={follow?.claimedAt ? styles.stepDone : styles.step}>
					<div className={styles.stepHead}>
						<span className={styles.index}>3</span>
						<span className={styles.xp}>
							+{(follow?.xp ?? 100).toLocaleString()} XP
						</span>
					</div>
					<h3>Follow Solve3fi</h3>
					<p className={styles.muted}>
						{follow?.claimedAt
							? "Thanks for following."
							: `Follow @solve3fi on X for launch news, then come back and claim. The claim unlocks ${UNLOCK_SECONDS} seconds after you open X.`}
					</p>
					{socialAction(
						ready ? follow : undefined,
						"Follow Solve3fi",
						"Follow Solve3fi",
					)}
				</li>

				<li className={post?.claimedAt ? styles.stepDone : styles.step}>
					<div className={styles.stepHead}>
						<span className={styles.index}>4</span>
						<span className={styles.xp}>
							+{(post?.xp ?? 100).toLocaleString()} XP
						</span>
					</div>
					<h3>Post on X</h3>
					<p className={styles.muted}>
						{post?.claimedAt
							? "Thanks for spreading the word."
							: "Pick a draft and introduce your timeline to Solve3. One post, one quest."}
					</p>
					{!post?.claimedAt && (
						<SocialPostComposer
							onOpened={
								ready && post
									? () => {
											setOpenedAt((current) => ({
												...current,
												"post-x": Date.now(),
											}));
											setNow(Date.now());
										}
									: undefined
							}
						/>
					)}
					{socialAction(ready ? post : undefined, "Post on X")}
				</li>

				<li className={lpDone ? styles.stepDone : styles.step}>
					<div className={styles.stepHead}>
						<span className={styles.index}>5</span>
						<span className={styles.xp}>
							+{(addLiquidity?.xp ?? 300).toLocaleString()} XP
						</span>
					</div>
					<h3>Add liquidity</h3>
					<p className={styles.muted}>
						{addLiquidity?.description ??
							"Keep at least $10 of liquidity in range in a featured pool for an hour. You also earn the pool's trading fees."}
					</p>
					{lp && !weeklyLpDone && (
						<p className={styles.muted}>
							This week's liquidity quest pays +{lp.testXp.toLocaleString()} XP
							more
							{lp.progress !== null
								? ` (${Math.min(lp.progress, lp.target)} / ${lp.target})`
								: ""}
							.
						</p>
					)}
					{lpDone ? (
						<span className={styles.done}>
							Earned
							{weeklyLpDone || !lp
								? ""
								: ". Keep it in range for the weekly quest"}
						</span>
					) : (
						<div className={styles.actions}>
							<a
								className={styles.cta}
								href={`/liquidity#${LAUNCH_POOLS_ANCHOR}`}
							>
								Choose a pool
							</a>
							{ready && (
								<span className={styles.muted}>
									XP lands within a few minutes of the hour
								</span>
							)}
						</div>
					)}
				</li>
			</ol>

			{message && (
				<p role="status" className={styles.message}>
					{message}
				</p>
			)}
			<Link className={styles.more} href="/quests">
				Weekly quests, referrals and your XP →
			</Link>
		</section>
	);
}
