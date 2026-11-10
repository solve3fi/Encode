"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCluster } from "@/providers/ClusterProvider";

type SnapRow = {
	addr: string;
	name: string;
	share: number;
	feePct: number;
	feeRate: number;
	core: boolean;
	mintA: string;
	mintB: string;
};
type Snap = { t: number; rows: SnapRow[] };

/**
 * The last Arena rows this browser saw. Reading them costs no network calls, so the card never slows a page down; it says
 * how old the numbers are, and a pair that is not in the snapshot is reported as such rather than guessed.
 */
const useArenaSnapshot = (): Snap | null | undefined => {
	const { network } = useCluster();
	const [snap, setSnap] = useState<Snap | null | undefined>(undefined);
	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(`s3v2:arena:${network}`);
			const parsed = raw ? (JSON.parse(raw) as Snap) : null;
			setSnap(parsed && Array.isArray(parsed.rows) && Date.now() - parsed.t < 24 * 3_600_000 ? parsed : null);
		} catch {
			setSnap(null);
		}
	}, [network]);
	return snap;
};

const ago = (t: number) => {
	const m = Math.max(1, Math.round((Date.now() - t) / 60_000));
	return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** "This pair in the Arena": the pool's vote share and rank, from the Arena's last snapshot. */
export const ArenaPairCard: React.FC<{ mintA?: string; mintB?: string; feeRate?: number; heading?: string }> = ({
	mintA,
	mintB,
	feeRate,
	heading = "THIS PAIR IN THE ARENA",
}) => {
	const snap = useArenaSnapshot();
	if (snap === undefined || !mintA || !mintB) return null;
	const same = (r: SnapRow) => (r.mintA === mintA && r.mintB === mintB) || (r.mintA === mintB && r.mintB === mintA);
	const found = snap ? snap.rows.filter(same) : [];
	const row = found.find((r) => feeRate !== undefined && r.feeRate === feeRate) ?? [...found].sort((a, b) => b.share - a.share)[0];
	const rank = row && snap ? [...snap.rows].sort((a, b) => b.share - a.share).findIndex((r) => r.addr === row.addr) + 1 : 0;
	return (
		<aside className="ap" aria-label="This pair in the Arena">
			<div className="ap-h">
				<span className="fc-eyebrow">{heading}</span>
				<Link href="/arena">Open →</Link>
			</div>
			{row ? (
				<>
					<div className="ap-name">
						<strong>{row.name}</strong>
						<span className="ap-tag">{row.core ? "Core" : "Community"}</span>
					</div>
					<div className="ap-row">
						<span>Rank <b>#{rank}</b></span>
						<span>Vote share <b>{row.share.toFixed(1)}%</b></span>
					</div>
					<div className="ap-bar" role="img" aria-label={`Vote share ${row.share.toFixed(1)}%`}>
						<span style={{ width: `${Math.min(100, row.share)}%` }} />
					</div>
					<p className="ap-note">
						Trades and liquidity in this pool earn fees for its voters this epoch. Numbers are from your last Arena visit ({ago(snap?.t ?? Date.now())}).
					</p>
				</>
			) : (
				<p className="ap-note">
					{snap
						? "This pair has no gauge in the Arena, so it gets no votes or emissions. It still earns trading fees."
						: "Open the Arena once to see this pair's rank and vote share here."}
				</p>
			)}
		</aside>
	);
};
