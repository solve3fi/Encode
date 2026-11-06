"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { FundNudge } from "@/components/Fund/FundNudge";
import { QuestsView } from "@/components/Genesis/QuestsView";
import { PassView } from "@/components/Pass/PassView";
import { useQuestSession } from "@/components/QuestTest/QuestSessionProvider";

type Tab = "quests" | "pass";

type SessionXp = {
	totalXp: number;
	voting?: { votingXp: number; votedThisEpoch: boolean; xpPerEpoch: number } | null;
} | null;

/**
 * Quests and the Solve3 Pass as one page. Both already read the same quest session, so they share a header: the wallet's
 * XP, then two tabs. The tab lives in the URL (/quests?tab=pass) so links and the old /pass route keep working.
 */
export const QuestPassHub: React.FC = () => {
	const params = useSearchParams();
	const router = useRouter();
	const tab: Tab = params.get("tab") === "pass" ? "pass" : "quests";
	const { state } = useQuestSession();
	const xp = (state as { xp?: SessionXp }).xp ?? null;

	const select = useCallback(
		(next: Tab) => {
			router.replace(next === "pass" ? "/quests?tab=pass" : "/quests", { scroll: false });
		},
		[router],
	);

	const stat = (label: string, value: string) => (
		<div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 96 }}>
			<span style={{ fontSize: 12, color: "#A6A4B8" }}>{label}</span>
			<strong style={{ fontSize: 20, color: "#F6F5F9" }}>{value}</strong>
		</div>
	);

	return (
		<div style={{ width: "min(calc(100% - 32px), 1180px)", margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
			<header
				style={{
					display: "flex",
					flexWrap: "wrap",
					alignItems: "center",
					justifyContent: "space-between",
					gap: "14px 24px",
					background: "#0E0E1C",
					border: "1px solid rgba(246,245,249,0.10)",
					borderRadius: 18,
					padding: "16px 20px",
				}}
			>
				<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
					<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#8C84FF" }}>QUESTS &amp; PASS</span>
					<h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-0.01em", color: "#F6F5F9" }}>Earn XP. Keep it on your Pass.</h1>
				</div>
				<div style={{ display: "flex", gap: 24, flexWrap: "wrap" }} aria-label="Your XP">
					{stat("Quest XP", xp ? xp.totalXp.toLocaleString() : "—")}
					{stat("Voting XP", xp?.voting ? xp.voting.votingXp.toLocaleString() : "—")}
				</div>
				<div role="tablist" aria-label="Quests and Pass" style={{ display: "flex", gap: 8 }}>
					{(
						[
							["quests", "Quests"],
							["pass", "Pass"],
						] as const
					).map(([k, label]) => (
						<button
							key={k}
							type="button"
							role="tab"
							aria-selected={tab === k}
							onClick={() => select(k)}
							style={{
								font: "inherit",
								fontSize: 14,
								fontWeight: 600,
								minHeight: 44,
								padding: "0 20px",
								borderRadius: 99,
								cursor: "pointer",
								color: tab === k ? "#F6F5F9" : "#C9C7D6",
								background: tab === k ? "rgba(104,93,247,0.2)" : "#141428",
								border: `1px solid ${tab === k ? "#8C84FF" : "rgba(246,245,249,0.12)"}`,
							}}
						>
							{label}
						</button>
					))}
				</div>
			</header>

			{tab === "pass" && (
				<FundNudge when="always" asset="choose" title="Need SOL or USDC to get started?" text="Bring funds from another chain to your wallet. This is a tip, not a quest, and it earns no XP." />
			)}
			{tab === "pass" ? <PassView embedded /> : <QuestsView compact />}
		</div>
	);
};
