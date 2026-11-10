"use client";

import Link from "next/link";
import { useClans } from "./useClans";

// Hooks cannot be called conditionally: when the caller already loaded clans, reuse that and skip the extra requests.
const useClansIf = (data?: unknown) => {
	const loaded = useClans(Boolean(data));
	return loaded;
};

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Arena side-panel card. It shows the clan war once the wallet is signed in to the quest session, and a plain invitation
 * before that: the Arena itself never asks for a wallet signature. Clans never add or pool voting power.
 */
type ClanData = Pick<ReturnType<typeof useClans>, "ready" | "overview" | "board">;

export const ClanWarCard: React.FC<{ data?: ClanData }> = ({ data }) => {
	const own = useClansIf(data);
	const { ready, overview, board } = data ?? own;
	const mine = ready ? overview?.clan : null;
	const leader = board?.clans[0];
	const title = mine ? `Your clan: ${mine.name}` : "Clan war";
	const line = mine
		? `Rank #${mine.rank} · ${n(mine.score)} backing a rally${leader && leader.id !== mine.id ? ` · ${n(Math.max(0, leader.score - mine.score))} behind ${leader.name}` : " · leading"}`
		: ready && leader
			? `${leader.name} leads with ${n(leader.score)} backing a rally`
			: "Rally votes behind a pool with your clan. Everyone votes with their own power.";
	return (
		<Link
			href="/quests?tab=clans"
			aria-label="Clan war"
			style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textDecoration: "none", background: "rgba(245,177,76,0.06)", border: "1px solid rgba(245,177,76,0.32)", borderRadius: 16, padding: "14px 18px", color: "#F6F5F9", minHeight: 44 }}
		>
			<span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
				<span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#F5B14C" }}>CLAN WAR</span>
				<span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
				<span style={{ fontSize: 12.5, color: "#A6A4B8" }}>{line}</span>
			</span>
			<span style={{ color: "#8C84FF", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>{mine ? "Open →" : "Find a clan →"}</span>
		</Link>
	);
};
