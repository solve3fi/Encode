"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEX_ONLY } from "@/configs/launchPhase";
import { formatDuration } from "@/lib/format";
import { useCluster } from "@/providers/ClusterProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { getEpochClockState } from "../Vote/epochClock";
import { ClanWarCard } from "../Clans/ClanWarCard";
import { useQuestSession } from "../QuestTest/QuestSessionProvider";

const WEEK = 7 * 86_400;
const R = 18;
const C = 2 * Math.PI * R;

/** Where the epoch is, from the same chain read as the header chip. Nothing is shown (or invented) before that read lands. */
export const useEpochNow = () => {
	const { network } = useCluster();
	const { data } = useVoteConfig(network);
	const [now, setNow] = useState(0);
	useEffect(() => {
		const tick = () => setNow(Date.now());
		tick();
		const id = window.setInterval(tick, 1000);
		return () => window.clearInterval(id);
	}, []);
	if (!data || !now) return null;
	const chainNow = Math.floor(data.chainTime + (now - data.localTimeAtFetch) / 1000);
	const toEnd = data.nextEpochTime - chainNow;
	const state = getEpochClockState(data.nextEpochTime, chainNow);
	return {
		epoch: data.epoch.toString(),
		toEnd,
		state,
		frac: Math.min(1, Math.max(0, 1 - toEnd / WEEK)),
	};
};

/** The strip under the header on the app's working pages: a small epoch ring and countdown, and what page you are on. */
export const FlowStrip: React.FC<{ context: string }> = ({ context }) => {
	const e = useEpochNow();
	const text = !e
		? "Reading chain clock"
		: e.state === "open"
			? `Voting closes in ${formatDuration(e.toEnd - 300)}`
			: e.state === "final-hour"
				? `Voting paused · epoch ends in ${formatDuration(e.toEnd)}`
				: "Epoch settling";
	return (
		<div className="fs" role="group" aria-label="Epoch and page">
			{DEX_ONLY ? (
				<div className="fs-l">
					<div className="fs-t">
						<b>Lite Launch</b>
						<span>Swaps and liquidity are live</span>
					</div>
				</div>
			) : (
				<div className="fs-l">
					<svg className="fs-ring" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
						<circle cx="22" cy="22" r={R} fill="none" stroke="rgba(246,245,249,.12)" strokeWidth="4" />
						<circle cx="22" cy="22" r={R} fill="none" stroke={e?.state === "open" ? "#8C84FF" : "#F5B14C"} strokeWidth="4" strokeLinecap="round" transform="rotate(-90 22 22)" style={{ strokeDasharray: `${(C * (e?.frac ?? 0)).toFixed(1)} ${C.toFixed(1)}` }} />
					</svg>
					<div className="fs-t">
						<b>Epoch {e ? e.epoch : "—"}</b>
						<span>{text}</span>
					</div>
				</div>
			)}
			<div className="fs-r">
				<span>You are on</span> <b>{context}</b>
			</div>
		</div>
	);
};

type QuestView = {
	status: string;
	xp?: { totalXp: number; onboarding: { id: string; title: string; xp: number; completed: boolean }[] } | null;
};

/** The next quest to do, and the wallet's Genesis XP once signed in. Quest XP never adds voting power. */
export const QuestsLeadCard: React.FC = () => {
	const { state } = useQuestSession();
	const view = state as QuestView;
	const ready = view.status === "READY";
	const next = ready ? view.xp?.onboarding.find((q) => !q.completed) : undefined;
	const line = next
		? `Next up: ${next.title} · +${next.xp} XP`
		: ready && view.xp
			? `Genesis XP ${view.xp.totalXp.toLocaleString("en-US")}`
			: "Earn XP for swapping and adding liquidity.";
	return (
		<Link href="/quests" className="fc-card" aria-label="Quests">
			<span className="fc-text">
				<span className="fc-eyebrow">QUESTS</span>
				<span className="fc-title">{line}</span>
				<span className="fc-sub">Separate from voting power</span>
			</span>
			<span className="fc-go">Quests →</span>
		</Link>
	);
};

/** Quests and the clan war, under every working page. */
export const FlowCards: React.FC = () => (
	<div className="fc" aria-label="Quests and clans">
		<QuestsLeadCard />
		<ClanWarCard />
	</div>
);
