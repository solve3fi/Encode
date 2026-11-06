"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PartnerScoutCard } from "@/components/QuestTest/PartnerScoutCard";
import { useQuestSession } from "@/components/QuestTest/QuestSessionProvider";
import { SocialQuestsCard } from "@/components/QuestTest/SocialQuestsCard";
import { GENESIS_PLAN } from "@/configs/genesis";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { weeklyQuestAction } from "../../../scripts/quest/quest-actions.mjs";
import { PermanentQuests, type VotingOverview } from "./PermanentQuests";
import { QuestLeaderboard } from "./QuestLeaderboard";
import classes from "./Quests.module.css";
import { FundNudge } from "@/components/Fund/FundNudge";

// ---- what the quest backend sends (the same shapes the weekly panel and referral card already use)
type WeeklyQuest = {
	metric: string;
	instanceKey: string;
	title: string;
	flavorText: string;
	description: string;
	target: number;
	progress: number | null;
	testXp: number;
	status: string;
};
type Onboarding = { id: string; xp: number; completed: boolean; awardedAt: string | null };
type CommunityGoal = {
	id: string;
	title: string;
	flavorText: string;
	endsAt: string;
	startsAt: string;
	xp: number;
	status: "UPCOMING" | "ACTIVE" | "EXPIRED" | "COMPLETED";
	completedAt: string | null;
	received: boolean;
};
type Receipt = { completionKey: string; testXp: number; startsAt: string; slot: number; expired: boolean; recordedAt: string };
type QuestState = {
	status: string;
	error: string | null;
	xp: { totalXp: number; onboarding: Onboarding[]; community?: CommunityGoal[]; voting?: VotingOverview | null; leaderboard?: { publicId: string; label: string; rank: number | null } | null } | null;
	snapshot: {
		achievements?: { rows: { id: string; progress: number | null; target: number }[] } | null;
		weekly: { quests: WeeklyQuest[]; expiresAt: string } | null;
		communityGoals: { id: string; title: string; state: string; targetUsdCents: string; testXp: number; endsAt: string }[];
		milestones: { goalId: string; observedTvlUsdCents: string }[];
	} | null;
	history: { receipts: Receipt[]; nextCursor: object | null } | null;
};
type Overview = { code: string; ratePercent: number; maxReferrals: number; referredCount: number; bonusXp: number; referredBy: boolean; result?: string };
type ReferralApi = { referral: () => Promise<Overview>; redeemReferral: (code: string) => Promise<Overview> };

// ---- display model
type Category = "Start" | "Weekly" | "Trading" | "Liquidity" | "Referral" | "Community";
type RowState = "locked" | "todo" | "progress" | "done" | "unavailable" | "untracked";
type Row = {
	id: string;
	category: Category;
	title: string;
	kind: string;
	quip: string;
	activity: string;
	clarification?: string;
	xp: number | null;
	goal: string;
	href?: string;
	external?: boolean;
	cta: string;
	action?: "connect";
	state: RowState;
	value: number;
	target: number;
	progLabel: string;
	progNote: string;
};

const liquidityReferralClarification = (xp: number) =>
	`Earn ${xp.toLocaleString()} XP once per active week. Existing referrals can qualify again by meeting that week’s liquidity requirements.`;

const META: Record<Category, { color: string; bg: string; glyph: string }> = {
	Start: { color: "#58d7ff", bg: "rgba(88,215,255,0.14)", glyph: "▶" },
	Weekly: { color: "#f5b14c", bg: "rgba(245,177,76,0.14)", glyph: "↻" },
	Trading: { color: "#58d7ff", bg: "rgba(88,215,255,0.14)", glyph: "⇄" },
	Liquidity: { color: "#8c84ff", bg: "rgba(140,132,255,0.16)", glyph: "◆" },
	Referral: { color: "#f5b14c", bg: "rgba(245,177,76,0.14)", glyph: "✦" },
	Community: { color: "#7be0a8", bg: "rgba(123,224,168,0.14)", glyph: "⚑" },
};
const CATEGORIES: ReadonlyArray<"all" | Category> = ["all", "Start", "Weekly", "Trading", "Liquidity", "Referral", "Community"];
const TIERS: ReadonlyArray<readonly [string, string, string, string]> = [
	["Explorer", "Start here", "#a6a4b8", "rgba(166,164,184,0.12)"],
	["Trader", "Verified trading", "#58d7ff", "rgba(88,215,255,0.14)"],
	["Liquidity Provider", "Sustained liquidity", "#8c84ff", "rgba(140,132,255,0.18)"],
	["Liquidity Builder", "Deep contribution", "#f5b14c", "rgba(245,177,76,0.16)"],
	["Founding LP", "Genesis legend", "#ffd98a", "rgba(255,217,138,0.16)"],
];
const DISCORD = "https://discord.gg/ZDyXeyjGc7";
const X_PROFILE = "https://x.com/solve3fi";
const ERRORS: Record<string, string> = {
	UNAUTHORIZED: "Wallet verification failed. Reconnect or retry the sign-in message.",
	FORBIDDEN: "Your session or link is no longer valid. Sign in again.",
	RATE_LIMITED: "Too many requests. Wait a moment and try again.",
	UNAVAILABLE: "Progress unavailable. Your activity has not been replaced with zero.",
};

// Catalogue defaults before sign-in; verified backend projections supply progress.
type Catalogue = Omit<Row, "state" | "value" | "target" | "progLabel" | "progNote">;
const CATALOGUE: readonly Catalogue[] = [
	{ id: "connect", category: "Start", title: "Connect your wallet", kind: "One-time", quip: "Sign in once with your wallet to prove you own it. Counts once per Passport.", activity: "Sign in with the wallet you will use for Genesis.", xp: 100, goal: "1 wallet", cta: "Connect wallet", action: "connect" },
	{ id: "mint-pass", category: "Start", title: "Mint your Solve3 Pass", kind: "One-time", quip: "Your free Pass carries your XP and launch status. It counts once the mint is confirmed on-chain.", activity: "Mint your Pass with a connected wallet.", xp: 250, goal: "1 Pass", href: "/pass", cta: "Mint your Pass" },
	{ id: "weekly-witness", category: "Weekly", title: "You Brought a Witness.", kind: "Weekly", quip: "Make sure they actually trade before taking a bow.", activity: "Get one qualified trader referral during this epoch.", xp: 300, goal: "Resets Thursday 00:00 UTC", href: "/pass", cta: "Get your link" },
	{ id: "weekly-adult", category: "Weekly", title: "Recruit an Adult With Liquidity.", kind: "Weekly", quip: "A friend with a funded pool position. Look at you networking.", activity: "Get one qualified liquidity-provider referral during this epoch.", clarification: liquidityReferralClarification(600), xp: 600, goal: "Resets Thursday 00:00 UTC", href: "/pass", cta: "Get your link" },
	{ id: "weekly-swaps", category: "Weekly", title: "Five Swaps. Still Standing.", kind: "Weekly", quip: "Your mouse has filed a complaint.", activity: "Complete five qualifying swaps during this epoch.", xp: 400, goal: "Resets Thursday 00:00 UTC", href: "/swap", cta: "Go to Swap" },
	{ id: "first-swap", category: "Trading", title: "First Swap", kind: "One-time", quip: "You pressed the swap button. The market survived. So did you.", activity: "Make a qualifying swap on Solve3.", xp: null, goal: "1 swap", href: "/swap", cta: "Go to Swap" },
	{ id: "trade-three-days", category: "Trading", title: "Trade on 3 Different Days", kind: "One-time", quip: "Three different days? Look at you developing a habit.", activity: "Trade on three distinct qualifying days.", xp: null, goal: "3 days", href: "/swap", cta: "Go to Swap" },
	{ id: "trade-seven-days", category: "Trading", title: "Trade on 7 Different Days", kind: "One-time", quip: "Seven separate days. Your calendar is getting suspiciously ambitious.", activity: "Trade on seven distinct qualifying days.", xp: null, goal: "7 days", href: "/swap", cta: "Go to Swap" },
	{ id: "provide-liquidity", category: "Liquidity", title: "Provide Liquidity", kind: "One-time", quip: "You brought liquidity to the party. Finally, someone remembered the snacks.", activity: "Add qualifying liquidity to a featured pool.", xp: 300, goal: "1 position", href: "/liquidity", cta: "Add liquidity" },
	{ id: "lp-seven-days", category: "Liquidity", title: "LP for 7 Days", kind: "One-time", quip: "Seven days in the pool. Patience looks weirdly good on you.", activity: "Maintain qualifying liquidity for seven days.", xp: null, goal: "7 days", href: "/liquidity", cta: "Manage liquidity" },
	{ id: "refer-trader", category: "Referral", title: "Refer a Trader", kind: "One-time", quip: "You brought a friend. Now let’s see if they came to trade.", activity: "Invite a trader who completes qualifying activity.", xp: null, goal: "1 trader", href: "/pass", cta: "Get your link" },
	{ id: "break-solve3", category: "Community", title: "Break Solve3", kind: "One-time", quip: "Found a bug? Give us the steps so we can have a productive little panic.", activity: "Submit a reproducible issue for review.", xp: null, goal: "1 report", href: DISCORD, external: true, cta: "Report on Discord" },
	{ id: "community-goal", category: "Community", title: "Half a Million. Collectively, Somehow.", kind: "Monthly goal", quip: "Hit the community volume target together and every eligible Passport earns the reward.", activity: "Trade or provide liquidity while the community total climbs to $500,000.", xp: null, goal: "Monthly community goal", href: "/swap", cta: "Go to Swap" },
];

const dateOnly = (iso: string) => iso.slice(0, 10);
const money = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const statusLabel: Record<RowState, string> = {
	locked: "Locked",
	todo: "Not started",
	progress: "In progress",
	done: "Done",
	unavailable: "Unavailable",
	untracked: "Not tracked yet",
};
const statusStyle = (state: RowState): React.CSSProperties =>
	state === "done"
		? { background: "rgba(123,224,168,0.14)", color: "#7be0a8" }
		: state === "progress"
			? { background: "rgba(88,215,255,0.14)", color: "#58d7ff" }
			: state === "unavailable"
				? { background: "rgba(245,177,76,0.14)", color: "#f5b14c" }
				: { background: "rgba(246,245,249,0.08)", color: state === "locked" ? "#a6a4b8" : "#c9c7d6" };

/** Weekly quest status from the backend: done when completed or at target, unavailable when progress could not be read. */
function weeklyState(q: WeeklyQuest, ready: boolean): { state: RowState; value: number; label: string } {
	if (!ready) return { state: "locked", value: 0, label: "Sign in to see progress" };
	if (q.progress === null) return { state: "unavailable", value: 0, label: "Progress unavailable" };
	const value = Math.min(q.progress, q.target);
	const done = /COMPLET|DONE|CLAIMED/i.test(q.status) || value >= q.target;
	return { state: done ? "done" : value > 0 ? "progress" : "todo", value, label: `${value} / ${q.target}` };
}

function buildRows(view: QuestState, ready: boolean, settling: boolean): Row[] {
	const onboarding = view.xp?.onboarding ?? [];
	const connect = onboarding.find((q) => q.id === "connect-wallet");
	const mint = onboarding.find((q) => q.id === "mint-pass");
	const addLiquidity = onboarding.find((q) => q.id === "add-liquidity");
	const weekly = view.snapshot?.weekly?.quests ?? null;
	const goal = view.snapshot?.communityGoals.find((g) => g.state === "ACTIVE");
	const reached = goal ? view.snapshot?.milestones.find((m) => m.goalId === goal.id) : undefined;
	const rows: Row[] = [];

	const base = (c: Catalogue, over: Partial<Row>): Row => ({
		...c,
		state: ready ? "untracked" : "locked",
		value: 0,
		target: 1,
		progLabel: ready ? "Not tracked yet" : "Sign in to see progress",
		progNote: ready ? "Tracking opens at Genesis" : c.goal,
		...over,
	});

	for (const c of CATALOGUE) {
		if (c.id === "connect") {
			const done = Boolean(connect?.completed);
			rows.push(base(c, {
				xp: connect?.xp ?? c.xp,
				state: done ? "done" : ready ? "todo" : "locked",
				value: done ? 1 : 0,
				progLabel: done ? "1 / 1" : "0 / 1",
				progNote: done && connect?.awardedAt ? `Done ${dateOnly(connect.awardedAt)}` : c.goal,
				// once signed in there is nothing left to connect
				action: ready ? undefined : c.action,
				href: ready ? "/quests?tab=pass" : undefined,
				cta: ready ? "Your Pass" : c.cta,
			}));
		} else if (c.id === "mint-pass") {
			const done = Boolean(mint?.completed);
			rows.push(base(c, {
				xp: mint?.xp ?? c.xp,
				state: done ? "done" : ready ? "todo" : "locked",
				value: done ? 1 : 0,
				progLabel: done ? "1 / 1" : ready ? "0 / 1" : "Sign in to see progress",
				progNote: done && mint?.awardedAt ? `Done ${dateOnly(mint.awardedAt)}` : c.goal,
			}));
		} else if (c.id === "provide-liquidity") {
			// One-time add-liquidity onboarding quest (migration 033): +300 XP, awarded by the XP settler.
			const done = Boolean(addLiquidity?.completed);
			rows.push(base(c, addLiquidity
				? {
					xp: addLiquidity.xp,
					state: done ? "done" : ready ? "todo" : "locked",
					value: done ? 1 : 0,
					progLabel: done ? "1 / 1" : "0 / 1",
					progNote: done && addLiquidity.awardedAt ? `Done ${dateOnly(addLiquidity.awardedAt)}` : c.goal,
				}
				: { state: ready ? "unavailable" : "locked", progLabel: ready ? "Verified progress unavailable" : "Sign in to see progress", progNote: "First qualifying position · 300 XP" }));
		} else if (c.category === "Weekly") {
			if (c.id !== "weekly-witness") continue; // the three fallback rows are replaced together by the live weekly set
			if (weekly && weekly.length > 0) {
				weekly.forEach((q) => {
					const s = weeklyState(q, ready);
					rows.push({
						id: `weekly-${q.instanceKey}`,
						category: "Weekly",
						title: q.title,
						kind: "Weekly",
						quip: q.flavorText,
						activity: q.description,
						clarification: q.metric === "qualifiedLpReferrals" ? liquidityReferralClarification(q.testXp) : undefined,
						xp: q.testXp,
						goal: "Resets Thursday 00:00 UTC",
						...weeklyQuestAction(q.metric),
						state: s.state,
						value: s.value,
						target: q.target,
						progLabel: s.label,
						progNote: "Resets Thursday 00:00 UTC",
					});
				});
			} else if (!settling) {
				// While a sign-in is still resolving, show no weekly rows rather than fallback titles the live set would replace.
				for (const w of CATALOGUE.filter((x) => x.category === "Weekly")) {
					rows.push(base(w, {
						state: ready ? "unavailable" : "locked",
						progLabel: ready ? "Progress unavailable" : "Sign in to see progress",
						progNote: w.goal,
					}));
				}
			}
		} else if (c.id === "community-goal") {
			if (goal) {
				const target = Number(goal.targetUsdCents) / 100;
				const total = reached ? Number(reached.observedTvlUsdCents) / 100 : null;
				const percent = total !== null && target > 0 ? Math.min(100, (total / target) * 100) : 0;
				rows.push({
					...c,
					title: goal.title,
					xp: goal.testXp,
					activity: `Help community liquidity reach ${money(target)}.`,
					goal: `Ends ${dateOnly(goal.endsAt)} 00:00 UTC`,
					state: !ready ? "locked" : total === null ? "unavailable" : percent >= 100 ? "done" : percent > 0 ? "progress" : "todo",
					value: percent,
					target: 100,
					progLabel: !ready ? "Sign in to see progress" : total === null ? "Progress unavailable" : `${money(total)} of ${money(target)}`,
					progNote: `Ends ${dateOnly(goal.endsAt)} 00:00 UTC`,
				});
			} else {
				if (!ready) rows.push(base({ ...c, title: "Community milestones", activity: "Help complete the active community goal reviewed by the Solve3 team.", quip: "Work together. The team verifies the milestone.", goal: "Sign in for the active goal" }, {}));
			}
		} else if (c.id === "break-solve3") {
			rows.push(base(c, { kind: "Reviewed submission", state: ready ? "todo" : "locked", progLabel: "Submit for review", progNote: "Reviewed by the team; no automatic XP." }));
		} else {
			const achievement = view.snapshot?.achievements?.rows.find((a) => a.id === c.id);
			const progress = achievement?.progress ?? null;
			const target = achievement?.target ?? (c.id === "trade-three-days" ? 3 : c.id === "trade-seven-days" || c.id === "lp-seven-days" ? 7 : 1);
			rows.push(base(c, { kind: "Achievement", state: !ready ? "locked" : progress === null ? "unavailable" : progress >= target ? "done" : progress > 0 ? "progress" : "todo", value: progress ?? 0, target, progLabel: !ready ? "Sign in to see progress" : progress === null ? "Verified progress unavailable" : `${progress} / ${target}`, progNote: "Verified Devnet activity · no extra XP" }));
		}
	}

	// Community goals a person completes by hand (for example "Get a partner onboarded"): shown while open or just decided.
	for (const g of view.xp?.community ?? []) {
		if (g.status === "UPCOMING" || (g.status === "EXPIRED" && g.completedAt === null)) continue;
		rows.push({
			id: `manual-${g.id}`,
			category: "Community",
			title: g.title,
			kind: "Community goal",
			quip: g.flavorText,
			activity: g.status === "COMPLETED"
				? g.received
					? `You received +${g.xp.toLocaleString()} XP.`
					: "Completed before your Passport existed, so it did not pay you."
				: "The Solve3 team marks this complete when it happens, and every Passport is paid at that moment.",
			xp: g.xp,
			goal: `Ends ${dateOnly(g.endsAt)} 00:00 UTC`,
			cta: "Open Discord",
			href: DISCORD,
			external: true,
			state: !ready ? "locked" : g.status === "COMPLETED" ? "done" : "todo",
			value: g.status === "COMPLETED" ? 1 : 0,
			target: 1,
			progLabel: g.status === "COMPLETED" ? "Completed" : "Open",
			progNote: `Ends ${dateOnly(g.endsAt)} 00:00 UTC`,
		});
	}
	return rows;
}

/** The referral code and counts for the signed-in wallet (the server applies every bonus; nothing here awards XP). */
function useReferral(ready: boolean, client: unknown) {
	const api = client as ReferralApi | undefined;
	const [overview, setOverview] = useState<Overview | null>(null);
	const [failed, setFailed] = useState(false);
	const load = useCallback(async () => {
		if (!api) return;
		try {
			setOverview(await api.referral());
			setFailed(false);
		} catch {
			setOverview(null);
			setFailed(true);
		}
	}, [api]);
	useEffect(() => {
		if (ready) void load();
		else {
			setOverview(null);
			setFailed(false);
		}
	}, [ready, load]);
	return { overview, failed, setOverview, api };
}

const REDEEM_MESSAGES: Record<string, string> = {
	OK: "Code accepted. Your friend earns a bonus on your weekly activity and voting XP from now on.",
	INVALID: "That code isn't valid.",
	SELF: "You can't use your own code.",
	ALREADY: "You have already used a referral code.",
	CYCLE: "That Passport already used your code.",
	FULL: "That code has reached its referral limit.",
};

export const QuestsView: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
	const { client, state, wallet, network, signMessage } = useQuestSession();
	const { setOpenModal } = useModalActions();
	const view = state as QuestState;
	const campaign = process.env.NEXT_PUBLIC_QUEST_TEST_CAMPAIGN;
	const busy = ["SIGNING", "LOADING"].includes(view.status);
	const ready = view.status === "READY";
	const [tab, setTab] = useState<"all" | Category>("all");
	const [open, setOpen] = useState<string>("first-swap");
	const [side, setSide] = useState<"lb" | "tier" | "rec">("lb");
	const { overview, failed, setOverview, api } = useReferral(ready, client);
	const [copied, setCopied] = useState(false);
	const [code, setCode] = useState("");
	const [note, setNote] = useState<string | null>(null);

	// A friend's link (...?ref=CODE) pre-fills the redeem box once.
	useEffect(() => {
		const param = new URLSearchParams(window.location.search).get("ref");
		if (param && /^[A-Za-z0-9]{8}$/.test(param)) setCode(param.toUpperCase());
	}, []);

	const settling = busy || (Boolean(wallet) && network === "devnet" && view.status === "DISCONNECTED" && !view.error);
	const rows = useMemo(() => buildRows(view, ready, settling), [view, ready, settling]);
	const visible = tab === "all" ? rows : rows.filter((row) => row.category === tab);
	const doneCount = rows.filter((row) => row.state === "done").length;
	const donePct = rows.length > 0 ? (doneCount / rows.length) * 100 : 0;
	const totalXp = view.xp ? view.xp.totalXp : null;
	const receipts = view.history?.receipts ?? [];
	const link = overview ? `${typeof window === "undefined" ? "" : window.location.origin}/pass?ref=${overview.code}` : "";
	const sessionOn = Boolean(campaign) && wallet && network === "devnet";

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setNote("Copy failed. Select the link and copy it manually.");
		}
	};
	const redeem = async () => {
		if (!api || !/^[A-Za-z0-9]{8}$/.test(code)) {
			setNote(REDEEM_MESSAGES.INVALID);
			return;
		}
		try {
			const value = await api.redeemReferral(code);
			setOverview(value);
			setNote(REDEEM_MESSAGES[value.result ?? "INVALID"] ?? REDEEM_MESSAGES.INVALID);
			if (value.result === "OK") setCode("");
		} catch {
			setNote("Referrals are unavailable right now. Try again soon.");
		}
	};

	const signTitle = !wallet ? "Sign up with your wallet." : ready ? "Wallet connected." : "Sign in to track your quests.";
	const signSub = !wallet
		? "Connect to start tracking XP and see your rank."
		: ready
			? "Your quests are tracking. Link Discord and X to unlock the social ones."
			: "One signed message proves the wallet is yours. It costs nothing and sends no transaction.";

	const signInCard = (
	<section
		className={`${classes.card} ${classes.sign}`}
		style={{ borderColor: ready ? "rgba(88,215,255,0.35)" : "rgba(140,132,255,0.35)" }}
		aria-label="Sign in"
	>
		<div className={classes.row}>
			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				<span className={classes.signTitle}>{signTitle}</span>
				<span className={classes.signSub}>{signSub}</span>
			</div>
			<div className={classes.referralActions}>
				{!wallet ? (
					<button type="button" className={classes.btn} onClick={() => setOpenModal(ModalType.WALLET)}>
						Connect wallet
					</button>
				) : ready ? (
					<>
						<button type="button" className={classes.ghost} disabled={busy} onClick={() => void client?.refresh()}>
							Refresh progress
						</button>
						<button type="button" className={classes.ghost} onClick={() => void client?.logout()}>
							Sign out
						</button>
					</>
				) : (
					<button
						type="button"
						className={classes.btn}
						disabled={busy || !signMessage || network !== "devnet" || !campaign}
						onClick={() => void client?.signIn(signMessage)}
					>
						{view.status === "SIGNING" ? "Waiting for your wallet…" : "Sign in"}
					</button>
				)}
			</div>
		</div>
		{!campaign && <p className={classes.notice}>Quest tracking is not switched on for this deployment.</p>}
		{campaign && wallet && network !== "devnet" && (
			<p className={classes.notice} role="status">
				Quests run on Solana devnet during the soft launch. Switch your wallet network to devnet.
			</p>
		)}
		{wallet && !signMessage && <p className={classes.notice}>This wallet does not support message signing.</p>}
		{busy && (
			<p className={classes.notice} role="status">
				{view.status === "SIGNING" ? "Approve the sign-in message in your wallet." : "Loading your progress…"}
			</p>
		)}
		{view.error && (
			<p className={classes.alert} role="alert">
				{ERRORS[view.error] ?? ERRORS.UNAVAILABLE}
			</p>
		)}
		<div className={classes.social}>
			<span className={`${classes.eyebrow} ${classes.muted}`} style={{ fontSize: 11 }}>Link accounts for social quests</span>
			<a className={`${classes.ghost} ${classes.small}`} href={DISCORD} target="_blank" rel="noopener noreferrer">Discord</a>
			<a className={`${classes.ghost} ${classes.small}`} href={X_PROFILE} target="_blank" rel="noopener noreferrer">X</a>
		</div>
	</section>
	);

	return (
		<div className={`${classes.page} ${compact ? classes.compact : ""}`}>
			<FundNudge when="low" asset="SOL" title="Need SOL for fees?" text="Quests need a little SOL for transaction fees." />
			{!compact && (
			<section className={`${classes.card} ${classes.banner}`}>
				<div className={classes.bannerArt}>
					<div className={classes.bannerShade} />
					<div className={classes.glow} />
					<div className={classes.bannerText}>
						<span className={classes.eyebrow} style={{ color: "#58d7ff" }}>Solve3 Genesis quests</span>
						<h1>
							Swap. Provide liquidity.
							<br />
							<span className={classes.grad}>Earn your place.</span>
						</h1>
					</div>
				</div>
				<div className={`${classes.row} ${classes.bannerFoot}`}>
					<div className={classes.bannerCopy}>
						<h2>Complete quests. Climb the board.</h2>
						<p>
							Genesis quests recognize verified trading, sustained liquidity, and contributions to the Solve3 community.{" "}
							<span className={classes.muted}>Genesis details will be published before launch.</span>
						</p>
					</div>
					<div className={classes.bannerStats}>
						<div className={classes.stat}>
							<span className={classes.lab}>Season ends</span>
							<span className={classes.big}>Set at Genesis</span>
						</div>
						<div className={classes.stat}>
							<span className={classes.lab}>Rewards pool</span>
							<span className={classes.big}>
								Up to {GENESIS_PLAN.genesisMaximumSolv3.toLocaleString("en-US")} <span className={classes.bigNote}>SOLV3 · proposed</span>
							</span>
						</div>
					</div>
				</div>
			</section>
			)}
			{compact && (
				<p className={classes.sideNote} style={{ margin: 0 }}>
					Season ends: set at Genesis · Rewards pool: up to {GENESIS_PLAN.genesisMaximumSolv3.toLocaleString("en-US")} SOLV3 (proposed). Genesis details will be published before launch.
				</p>
			)}

			{!compact && signInCard}

			{/* your progress */}
			<section className={`${classes.card} ${classes.progress}`} aria-label="Your progress">
				<div className={classes.row}>
					{compact ? (
						<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
							{/* biome-ignore lint/performance/noImgElement: static SVG artwork */}
							<img src="/assets/pass/tier-1.svg" alt="" width={56} height={56} style={{ borderRadius: 12, flex: "none" }} />
							<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
								<h2 style={{ margin: 0 }}>Your Solve3 Pass</h2>
								<span className={classes.progNote}>One per wallet. Every Pass starts at Explorer and holds your Quest XP and Voting XP.</span>
							</div>
						</div>
					) : (
						<h2>Your progress</h2>
					)}
					<div className={classes.referralActions}>
						{compact && !ready && (
							!wallet ? (
								<button type="button" className={classes.btn} onClick={() => setOpenModal(ModalType.WALLET)}>Connect wallet</button>
							) : (
								<button
									type="button"
									className={classes.btn}
									disabled={busy || !signMessage || network !== "devnet" || !campaign}
									onClick={() => void client?.signIn(signMessage)}
								>
									{view.status === "SIGNING" ? "Waiting for your wallet…" : "Sign in"}
								</button>
							)
						)}
						<Link href="/quests?tab=pass" className={`${classes.ghost} ${classes.small}`}>Your Pass →</Link>
						<Link href="/charter" className={`${classes.ghost} ${classes.small}`}>How XP works</Link>
					</div>
				</div>
				<div className={classes.stats}>
					<div className={classes.stat}>
						<span className={classes.lab}>Quest XP</span>
						<span className={`${classes.statBig} ${classes.amber}`}>{totalXp === null ? "—" : totalXp.toLocaleString()}</span>
						{wallet && !ready && !busy && <span className={classes.progNote}>Sign in to see your XP</span>}
						{view.xp?.voting && <span className={classes.progNote}>Voting XP: {view.xp.voting.votingXp.toLocaleString()}</span>}
					</div>
					<div className={classes.stat}>
						<span className={classes.lab}>Your rank</span>
						<span className={`${classes.statBig} ${classes.amber}`}>{view.xp?.leaderboard?.rank ? `#${view.xp.leaderboard.rank}` : "—"}</span>
						<span className={classes.progNote}>{view.xp?.leaderboard?.label ?? "Sign in for your public alias"}</span>
					</div>
					<div className={classes.stat}>
						<span className={classes.lab}>Planned tier path</span>
						<span style={{ fontSize: 20, fontWeight: 700 }}>Planned</span>
						<span className={classes.progNote}>Thresholds set at Genesis</span>
					</div>
					<div className={`${classes.stat} ${classes.statWide}`}>
						<div className={classes.row} style={{ flexWrap: "nowrap" }}>
							<span className={classes.lab}>Quest progress</span>
							<span style={{ fontSize: 13, fontWeight: 600 }}>{doneCount} / {rows.length} completed</span>
						</div>
						<div className={classes.bar} role="progressbar" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={doneCount} aria-label="Quests completed">
							<div className={classes.barFill} style={{ width: `${donePct}%` }} />
							<div
								className={classes.barGaps}
								style={{ backgroundImage: `repeating-linear-gradient(90deg,transparent 0,transparent calc(100% / ${Math.max(rows.length, 1)} - 3px),#0e0e1c calc(100% / ${Math.max(rows.length, 1)} - 3px),#0e0e1c calc(100% / ${Math.max(rows.length, 1)}))` }}
							/>
						</div>
					</div>
				</div>
				<div className={`${classes.inner} ${classes.referral}`}>
					{!ready ? (
						<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
							<span className={classes.referralTitle}>Bring a friend, earn together</span>
							<span className={classes.referralSub}>Connect and sign in to get your referral code.</span>
						</div>
					) : failed ? (
						<span className={classes.referralSub}>Referrals are unavailable right now.</span>
					) : !overview ? (
						<span className={classes.referralSub}>Loading…</span>
					) : (
						<>
							<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
								<span className={classes.referralTitle}>
									Earn <span className={classes.amber}>{overview.ratePercent}%</span> of your friends&rsquo; activity and voting XP
								</span>
								<span className={classes.referralSub}>
									Referral XP: <b className={classes.amber}>{overview.bonusXp.toLocaleString()}</b> · Friends joined:{" "}
									<b className={classes.amber}>{overview.referredCount}</b> of {overview.maxReferrals}
								</span>
							</div>
							<div className={classes.referralActions}>
								<span className={classes.referralSub}>Invite code <b className={classes.amber}>{overview.code}</b></span>
								<button type="button" className={classes.btn} onClick={() => void copy()}>
									{copied ? "Copied" : "Copy referral link"}
								</button>
							</div>
						</>
					)}
					{ready && overview && !overview.referredBy && (
						<details className={classes.details} style={{ flexBasis: "100%" }}>
							<summary>Have a friend&rsquo;s code?</summary>
							<div className={classes.redeem} style={{ marginTop: 10 }}>
								<input
									className={classes.input}
									value={code}
									maxLength={8}
									placeholder="8-character code"
									aria-label="Friend's referral code"
									onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
								/>
								<button type="button" className={`${classes.ghost} ${classes.small}`} disabled={code.length !== 8} onClick={() => void redeem()}>
									Use code
								</button>
							</div>
						</details>
					)}
					{ready && overview?.referredBy && <span className={classes.referralSub} style={{ flexBasis: "100%" }}>You joined with a referral code.</span>}
					{note && (
						<p className={classes.notice} role="status" style={{ flexBasis: "100%" }}>
							{note}
						</p>
					)}
				</div>
			</section>

			{compact && signInCard}

			{/* quests + sidebar */}
			<div className={classes.layout}>
				<section className={classes.explore} aria-label="Quests">
					<PermanentQuests ready={ready} voting={view.xp?.voting} />
					<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<h2>Explore quests</h2>
						<p className={classes.lede}>Start here, finish the weekly set, then chase the long ones. Tap a quest to see what counts.</p>
					</div>
					<div role="tablist" aria-label="Quest categories" className={classes.tabs}>
						{CATEGORIES.map((c) => {
							const count = c === "all" ? rows.length : rows.filter((row) => row.category === c).length;
							return (
								<button key={c} type="button" role="tab" aria-selected={tab === c} className={classes.tab} onClick={() => setTab(c)}>
									{c === "all" ? "All quests" : c}
									<span className={classes.n}>{count}</span>
								</button>
							);
						})}
					</div>
					<div className={classes.list} aria-live="polite">
						{visible.map((row) => {
							const meta = META[row.category];
							const isOpen = open === row.id;
							const pct = row.target > 0 ? Math.min(100, (row.value / row.target) * 100) : 0;
							return (
								<article key={row.id} className={classes.q} data-open={isOpen} style={{ borderLeftColor: meta.color }}>
									<button type="button" className={classes.qhead} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : row.id)}>
										<span className={classes.glyph} style={{ background: meta.bg, color: meta.color }} aria-hidden="true">{meta.glyph}</span>
										<span className={classes.qtitle}>
											<strong>{row.title}</strong>
											<span className={`${classes.eyebrow} ${classes.qtag}`}>
												{row.category === "Weekly" ? "Weekly · Expires Thursday" : `${row.category} · ${row.kind}`}
											</span>
										</span>
										<span className={classes.chip} style={statusStyle(row.state)}>
											{row.state === "locked" ? "🔒 " : ""}
											{statusLabel[row.state]}
										</span>
										<span className={classes.xp}>{row.xp === null ? row.kind === "Achievement" ? "Achievement" : "Review" : `+${row.xp.toLocaleString()} XP`}</span>
										<span className={classes.chev} aria-hidden="true">▾</span>
									</button>
									{isOpen && (
										<div className={classes.detail}>
											<p>{row.quip}</p>
											<div className={`${classes.inner} ${classes.counts}`}>
												<p><span>Counts when you: </span>{row.activity}</p>
												{row.clarification && <p>{row.clarification}</p>}
												<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
													<div className={classes.qbar}>
														<div className={classes.qbarFill} style={{ width: `${pct}%`, background: meta.color }} />
													</div>
													<div className={classes.row}>
														<span className={classes.progLine}>{row.progLabel}</span>
														<span className={classes.progNote}>{row.progNote}</span>
													</div>
												</div>
											</div>
											<div>
												{row.action === "connect" ? (
													<button type="button" className={classes.btn} onClick={() => setOpenModal(ModalType.WALLET)}>{row.cta}</button>
												) : row.href ? (
													row.external ? (
														<a className={classes.btn} href={row.href} target="_blank" rel="noopener noreferrer">{row.cta} ↗</a>
													) : (
														<Link className={classes.btn} href={row.href}>{row.cta}</Link>
													)
												) : null}
											</div>
										</div>
									)}
								</article>
							);
						})}
					</div>
				</section>

				<aside className={classes.side} aria-label="Leaderboard, tiers and receipts">
					<div className={classes.seg} role="tablist">
						<button type="button" role="tab" aria-selected={side === "lb"} onClick={() => setSide("lb")}>Leaderboard</button>
						<button type="button" role="tab" aria-selected={side === "tier"} onClick={() => setSide("tier")}>Tiers</button>
						<button type="button" role="tab" aria-selected={side === "rec"} onClick={() => setSide("rec")}>Receipts</button>
					</div>

					{side === "lb" && (
						<QuestLeaderboard />
					)}

					{side === "tier" && (
						<div className={`${classes.card} ${classes.panel} ${classes.tierPanel}`}>
							<div className={classes.row}>
								<span className={classes.eyebrow} style={{ color: "#58d7ff" }}>Planned tier path</span>
								<span className={`${classes.eyebrow} ${classes.muted}`} style={{ fontSize: 11 }}>Thresholds pending</span>
							</div>
							<ol className={classes.tiers}>
								{TIERS.map(([name, sub, color, bg], index) => (
									<li key={name}>
										<span className={classes.tierMark}>
											<span className={classes.tierNode} style={{ borderColor: color, background: bg, color }}>{String(index + 1).padStart(2, "0")}</span>
											{index < TIERS.length - 1 && (
												<span className={classes.tierLine} style={{ background: `linear-gradient(180deg, ${color}, rgba(140,132,255,0.15))` }} />
											)}
										</span>
										<span className={classes.tierText}>
											<strong>{name}</strong>
											<small>{sub}</small>
										</span>
									</li>
								))}
							</ol>
						</div>
					)}

					{side === "rec" &&
						(receipts.length > 0 ? (
							<div className={`${classes.card}`} style={{ overflow: "hidden" }}>
								<ul className={classes.receipts}>
									{receipts.map((r) => (
										<li key={r.completionKey}>
											<strong className={classes.amber}>+{r.testXp.toLocaleString()} XP</strong>
											<span>
												Week of {dateOnly(r.startsAt)} · quest {r.slot + 1}
												{r.expired ? " · expired quest, receipt kept" : ""}
											</span>
											<small>{dateOnly(r.recordedAt)}</small>
										</li>
									))}
								</ul>
								{view.history?.nextCursor && (
									<div style={{ padding: 12 }}>
										<button type="button" className={`${classes.ghost} ${classes.small}`} disabled={busy} onClick={() => void client?.more()}>
											Load older receipts
										</button>
									</div>
								)}
							</div>
						) : (
							<div className={`${classes.card} ${classes.empty}`}>
								<span className={classes.emptyIcon} aria-hidden="true">⚑</span>
								<span className={classes.emptyTitle}>
									{!ready ? "Receipts appear once you sign in" : view.history ? "No XP receipts yet" : "Receipts unavailable"}
								</span>
								<span className={classes.emptyText}>
									Finish a quest and its receipt shows up here with the XP and the date it was credited. Receipts record verified activity.
								</span>
							</div>
						))}

					<p className={classes.sideNote}>
						{sessionOn || ready ? "Weekly quests reset Thursday 00:00 UTC. XP is credited after activity verification." : "Connect and sign in to see your quests, XP and receipts. Weekly quests reset Thursday 00:00 UTC."}
					</p>
				</aside>
			</div>

			{/* one-time side quests and partner leads keep their existing, working cards */}
			<div className={classes.sideQuests}>
				<SocialQuestsCard key={`social-${wallet ?? "guest"}`} />
				<PartnerScoutCard key={`scout-${wallet ?? "guest"}`} />
			</div>

			<p className={classes.sideNote} style={{ textAlign: "center" }}>
				Campaign rewards remain provisional until eligibility review and finalization.{" "}
				<Link href="/charter" style={{ color: "#8c84ff" }}>How it works</Link>
			</p>
		</div>
	);
};
