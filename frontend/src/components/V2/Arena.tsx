"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import type { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TransactionStatus } from "@/components/ProtocolStatus/TransactionStatus";
import { SUPPORT_MINT_TOKENS, getLockTokenInfo } from "@/configs/lock";
import { INTENTS_ENABLED } from "@/configs/intents";
import { DEX_ONLY } from "@/configs/launchPhase";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { useAllPools } from "@/hooks/useAllPools";
import { useAllPositions } from "@/hooks/useAllPositions";
import { usePositions } from "@/hooks/usePositions";
import { useClaimAllRewards } from "@/hooks/useClaimAllRewards";
import { usePools as useDexPools } from "@/hooks/usePools";
import { useAcceleratedPools } from "@/hooks/useAcceleratedPools";
import { useAllTokens } from "@/hooks/useToken";
import { useUSDCPrice } from "@/hooks/useUSDCPrice";
import { getGaugePDA, getProtocolPDA, useVesolveProgram, vesolveAccount } from "@/hooks/useVesolveProgram";
import { formatApr, formatDuration } from "@/lib/format";
import { mapTransactionError } from "@/lib/transactionErrors";
import { useCluster } from "@/providers/ClusterProvider";
import { useLockData } from "@/stores/lock/hooks/useLockData";
import { useLocks } from "@/stores/lock/hooks/useLocks";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import { useUserVote } from "@/stores/vote/hooks/useUserVote";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { VoteProvider, useVote, useVoteActions } from "@/stores/vote/VoteProvider";
import { getExpolerUrl } from "@/utils/externalUrl";
import { useEmissionApr } from "@/hooks/useEmissionApr";
import { usePoolInfo } from "@/hooks/usePoolInfo";
import { DraftRewardEstimate } from "../Vote/DraftRewardEstimate";
import { VoteCastProvider, useVoteCast } from "../Vote/VoteCast";
import { getEpochClockState, VOTE_CUTOFF_SECONDS } from "../Vote/epochClock";
import { epochEmission, GAUGE_EMISSION_SHARE } from "../Vote/voteEstimate";
import { Flywheel as HomeFlywheel } from "../ProtocolHome/Flywheel";
import { type ArenaRow, useArenaGauges } from "./useArenaGauges";

const STEP = 5;
const PALETTE = ["#8C84FF", "#58D7FF", "#7BE0A8", "#F5B14C", "#FF8FB1", "#B3ADFF"];
const TOKEN_COLORS = ["#4F45D6", "#2B9E93", "#2775CA", "#6B4F3A", "#2E8B57", "#C9742B"];

export const compactUsd = (n: number | undefined) => {
	if (n === undefined || !Number.isFinite(n)) return "—";
	if (n <= 0) return "—";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		notation: n >= 10_000 ? "compact" : "standard",
		maximumFractionDigits: n >= 10_000 ? 1 : 2,
	}).format(n);
};
export const num = (n: number, max = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(n);
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export const TokenDot: React.FC<{ sym: string; logo?: string; second?: boolean }> = ({ sym, logo, second }) => (
	<span
		aria-hidden="true"
		style={{
			width: 34,
			height: 34,
			borderRadius: "50%",
			background: TOKEN_COLORS[hash(sym) % TOKEN_COLORS.length],
			border: "2px solid #0E0E1C",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			fontSize: 10,
			fontWeight: 700,
			color: "#fff",
			marginLeft: second ? -10 : 0,
			overflow: "hidden",
			flex: "none",
		}}
	>
		{logo ? (
			// biome-ignore lint/performance/noImgElement: remote token logos
			<img src={logo} alt="" width={34} height={34} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
		) : (
			sym.slice(0, 3).toUpperCase()
		)}
	</span>
);

export const AccelChip: React.FC<{ epochs: number }> = ({ epochs }) => (
	<span
		title={`Accelerator Program partner: ${epochs} epoch${epochs === 1 ? "" : "s"} of matched votes remaining`}
		style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 99, whiteSpace: "nowrap", background: "rgba(245,177,76,0.14)", color: "#F5B14C", border: "1px solid rgba(245,177,76,0.4)" }}
	>
		Accelerator · {epochs} left
	</span>
);

export const TagChip: React.FC<{ core: boolean }> = ({ core }) => (
	<span
		style={{
			fontSize: 11.5,
			fontWeight: 700,
			padding: "3px 10px",
			borderRadius: 99,
			whiteSpace: "nowrap",
			...(core
				? { background: "#1B1B36", color: "#C9C7D6" }
				: { background: "rgba(88,215,255,0.12)", color: "#58D7FF", border: "1px solid rgba(88,215,255,0.35)" }),
		}}
	>
		{core ? "Core" : "Community"}
	</span>
);

export const Note: React.FC<{ tone: "cyan" | "amber" | "grey"; children: React.ReactNode }> = ({ tone, children }) => {
	const c = {
		cyan: ["rgba(88,215,255,0.07)", "rgba(88,215,255,0.30)", "#58D7FF"],
		amber: ["rgba(245,177,76,0.08)", "rgba(245,177,76,0.40)", "#F5B14C"],
		grey: ["#0E0E1C", "rgba(246,245,249,0.16)", "#A6A4B8"],
	}[tone];
	return (
		<div role="status" style={{ display: "flex", gap: 14, alignItems: "flex-start", background: c[0], border: `1px solid ${c[1]}`, borderRadius: 16, padding: "16px 20px" }}>
			<span style={{ width: 8, height: 8, borderRadius: "50%", background: c[2], marginTop: 8, flex: "none" }} />
			<p style={{ fontSize: 14.5, lineHeight: 1.55, color: "#E4E2EE" }}>{children}</p>
		</div>
	);
};

/** The same flywheel visual the home page uses. */
export const Flywheel: React.FC = () => (
	<section aria-label="Flywheel" className="fw-home">
		<HomeFlywheel />
	</section>
);

export const Disclaimer: React.FC = () => (
	<p style={{ fontSize: 12.5, lineHeight: 1.6, color: "#A6A4B8", maxWidth: 900 }}>
		Rewards depend on votes, trading volume and fee tiers, and are not guaranteed. Liquidity positions can lose value against holding the tokens. Locks are permanent. Confirm every transaction in your wallet.
	</p>
);

/** Chain-synced clock: seconds of chain time now, advanced locally between the 15 s refetches. */
const useChainNow = () => {
	const { network } = useCluster();
	const { data } = useVoteConfig(network);
	const [now, setNow] = useState(0);
	useEffect(() => {
		const tick = () => setNow(Date.now());
		tick();
		const id = window.setInterval(tick, 1000);
		return () => window.clearInterval(id);
	}, []);
	return useMemo(() => {
		if (!data || !now) return null;
		return { data, chainNow: Math.floor(data.chainTime + (now - data.localTimeAtFetch) / 1000) };
	}, [data, now]);
};

/** Same protocol-wide TVL as the classic ProtocolMetrics strip. */
const useProtocolTvl = () => {
	const addresses = useAllPools();
	const pools = useDexPools(addresses.data);
	const amounts: Record<string, number> = {};
	for (const pool of pools.data ?? []) {
		for (const [mint, vault] of [
			[pool.getTokenAInfo(), pool.getTokenVaultAInfo()],
			[pool.getTokenBInfo(), pool.getTokenVaultBInfo()],
		] as const) {
			const address = mint.mint.toString();
			amounts[address] = (amounts[address] ?? 0) + new Decimal(vault.amount.toString()).div(new Decimal(10).pow(mint.decimals)).toNumber();
		}
	}
	const valuation = useUSDCPrice(amounts);
	const complete =
		addresses.data !== undefined && !addresses.isError && !pools.isError && (addresses.data.length === 0 || pools.data?.length === addresses.data.length);
	return {
		tvl: complete && valuation.isComplete && !valuation.isLoading ? valuation.totalUsdcValue.toNumber() : undefined,
		poolCount: addresses.data?.length,
		breakdown: valuation.breakdown,
		pools: pools.data,
		poolsLoading: addresses.isLoading || pools.isLoading,
		poolsError: addresses.isError || pools.isError,
	};
};

const EmissionAprText: React.FC<{ addr: string }> = ({ addr }) => {
	const { data: pool } = usePoolInfo(addr);
	const { apr, isLoading, pricingComplete } = useEmissionApr(pool);
	if (isLoading || pricingComplete === false) return <>—</>;
	const value = apr.toNumber();
	const text = formatApr(value, { ceiling: 10_000 }).replace(/ APR$/, "");
	return value > 10_000 ? (
		<span title="Very high because this pool's liquidity is thin, so the figure is not meaningful.">{text}*</span>
	) : (
		<>{text}</>
	);
};

/** Mounted only after the gauge rows are shown, so its pool and price reads do not compete with them. */
const TvlValue: React.FC = () => <>{compactUsd(useProtocolTvl().tvl)}</>;

type CachedRow = {
	addr: string; name: string; symA: string; symB: string; logoA?: string; logoB?: string; feePct: number;
	tvlUsd: number; votes: number; share: number; bribesUsd: number; feesUsd: number; rewardsUsd: number;
	estSolv3: number; core: boolean; mintA: string; mintB: string; feeRate: number;
};
type CachedSnapshot = { t: number; epoch: number; rows: CachedRow[] };

type Phase = "open" | "closing-soon" | "closed";

/* ------------------------------------------------------------------ Full profile ------------------------------------------------------------------ */

const ArenaFull: React.FC = () => {
	const { publicKey } = useWallet();
	const connected = Boolean(publicKey);
	const { network } = useCluster();
	const accelerated = useAcceleratedPools(network);
	const { setOpenModal } = useModalActions();
	const clock = useChainNow();
	const { rows, epoch, isLoading, error, retry } = useArenaGauges();
	const [late, setLate] = useState(false);
	useEffect(() => {
		if (isLoading || error) return;
		const t = window.setTimeout(() => setLate(true), 800);
		return () => window.clearTimeout(t);
	}, [isLoading, error]);

	const [sort, setSort] = useState<"share" | "tvl" | "bribes" | "fees" | "total">("share");
	const [comm, setComm] = useState(false);
	const [review, setReview] = useState(false);

	// Last live rows, kept in this browser only. Shown read-only while the live chain data loads, then replaced by it.
	const snapKey = `s3v2:arena:${network}`;
	const [cached, setCached] = useState<CachedSnapshot | null>(null);
	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(snapKey);
			if (!raw) return;
			const parsed = JSON.parse(raw) as CachedSnapshot;
			if (parsed && Array.isArray(parsed.rows) && Date.now() - parsed.t < 24 * 3600_000) setCached(parsed);
		} catch {
			/* storage unavailable: just load live */
		}
	}, [snapKey]);
	useEffect(() => {
		if (isLoading || error || rows.length === 0) return;
		try {
			const snap: CachedSnapshot = {
				t: Date.now(),
				epoch,
				rows: rows.map((r) => {
					const d = r.info.getData();
					return {
						addr: r.addr, name: r.name, symA: r.symA, symB: r.symB, logoA: r.logoA, logoB: r.logoB, feePct: r.feePct,
						tvlUsd: r.tvlUsd, votes: r.votes, share: r.share, bribesUsd: r.bribesUsd, feesUsd: r.feesUsd,
						rewardsUsd: r.rewardsUsd, estSolv3: r.estSolv3, core: r.core,
						mintA: d.tokenMintA.toString(), mintB: d.tokenMintB.toString(), feeRate: d.feeRate,
					};
				}),
			};
			window.localStorage.setItem(snapKey, JSON.stringify(snap));
		} catch {
			/* storage full or blocked: ignore */
		}
	}, [rows, isLoading, error, epoch, snapKey]);

	// ---- draft (shared vote store; the classic Vote page uses the same one) ----
	const voteState = useVote((s) => s.voteState);
	const lockId = useVote((s) => s.lockId);
	const { setVoteState, setLockId, resetVoteState } = useVoteActions();
	const total = useMemo(() => voteState.reduce((a, v) => a + v.votePercent, 0), [voteState]);
	const remaining = Math.max(0, 100 - total);
	const draftOf = useCallback(
		(addr: string) => voteState.find((v) => v.getAddress().toString() === addr)?.votePercent ?? 0,
		[voteState],
	);
	const setDraft = useCallback(
		(row: ArenaRow, pct: number) => {
			const others = voteState.reduce((a, v) => a + (v.getAddress().toString() === row.addr ? 0 : v.votePercent), 0);
			const votePercent = Number.isFinite(pct) ? Math.min(Math.max(Math.round(pct), 0), Math.max(0, Math.floor(100 - others))) : 0;
			setVoteState(Object.assign(Object.create(Object.getPrototypeOf(row.info)), row.info, { votePercent }));
		},
		[voteState, setVoteState],
	);

	// ---- phase ----
	let phase: Phase = "open";
	let toCutoff = 0;
	let toEnd = 0;
	let frac = 0;
	let settling = false;
	if (clock) {
		const { data, chainNow } = clock;
		const st = getEpochClockState(data.nextEpochTime, chainNow);
		toEnd = Math.max(0, data.nextEpochTime - chainNow);
		toCutoff = Math.max(0, toEnd - VOTE_CUTOFF_SECONDS);
		const span = Math.max(1, data.nextEpochTime - data.epochStartTime);
		frac = Math.min(1, Math.max(0, (chainNow - data.epochStartTime) / span));
		settling = st === "settling";
		phase = st === "open" ? (toCutoff <= 3600 ? "closing-soon" : "open") : "closed";
	}
	const isClosed = phase === "closed";
	const canVoteNow = !isClosed;

	// ---- lock / cast ----
	const voteCast = useVoteCast();
	const { data: locks } = useLocks();
	const { data: lock } = useLockData(lockId);
	useEffect(() => {
		if (!lockId && locks && locks.length > 0) setLockId(locks[0].identifier.toNumber());
	}, [lockId, locks, setLockId]);
	const veBalance = lock
		? lock.lockPower.div(new BN(10 ** (SUPPORT_MINT_TOKENS[lock.lockTokenMint.toBase58()] ?? getLockTokenInfo(lock.lockTokenMint.toBase58())).decimals)).toNumber()
		: 0;
	const { data: voteConfig } = useVoteConfig(network);
	const hasVotedThisEpoch = Boolean(voteConfig && lock && !lock.lastVoteEpoch.isZero() && lock.lastVoteEpoch.eq(voteConfig.epoch));
	const isPending = voteCast?.isPending ?? false;
	const transactionError = voteCast?.isError ? mapTransactionError(voteCast.error) : undefined;

	// ---- revote (identical rules to the classic Vote page) ----
	const program = useVesolveProgram();
	const { data: previousVote } = useUserVote(network, Math.max(0, epoch - 1), lockId);
	const [revoteNote, setRevoteNote] = useState<string | null>(null);
	const [revoteBusy, setRevoteBusy] = useState(false);
	const handleRevote = useCallback(async () => {
		if (!publicKey || !voteCast?.canVote || !previousVote || previousVote.votes.length === 0) return;
		const totalPower = previousVote.totalVotingPower.toNumber();
		if (totalPower <= 0) return;
		setRevoteBusy(true);
		setRevoteNote(null);
		try {
			const [protocolAddress] = getProtocolPDA();
			const pools: PublicKey[] = [];
			const powers: number[] = [];
			let skipped = 0;
			for (const { gauge, weight } of previousVote.votes) {
				const account = await vesolveAccount.gauge(program).fetchNullable(gauge);
				const acceptsVotes = account && (account.status === 1 || account.status === 2);
				if (!account || !acceptsVotes || !getGaugePDA(protocolAddress, account.poolAddress)[0].equals(gauge)) {
					skipped++;
					continue;
				}
				pools.push(account.poolAddress);
				powers.push(Math.round((weight.toNumber() * 100) / totalPower));
			}
			if (pools.length === 0) {
				setRevoteNote("None of last epoch's gauges can take votes now.");
				return;
			}
			const overshoot = powers.reduce((s, p) => s + p, 0) - 100;
			if (overshoot > 0) powers[powers.indexOf(Math.max(...powers))] -= overshoot;
			const allocated = powers.reduce((s, p) => s + p, 0);
			const notes: string[] = [];
			if (skipped > 0) notes.push(`${skipped} of last epoch's gauges can no longer take votes and were left out.`);
			if (allocated < 100) notes.push(`This revote uses ${allocated}% of your voting power; the other ${100 - allocated}% will not earn rewards this epoch.`);
			if (notes.length > 0) setRevoteNote(notes.join(" "));
			voteCast.castWith({ pools, powers }, "panel");
		} catch (e) {
			setRevoteNote(e instanceof Error ? e.message : "Could not load last epoch's vote.");
		} finally {
			setRevoteBusy(false);
		}
	}, [publicKey, voteCast, previousVote, program]);

	const castDone = Boolean(voteCast?.isSuccess || voteCast?.isError);
	useEffect(() => {
		if (castDone && typeof window !== "undefined" && window.innerWidth <= 1000)
			document.getElementById("vote-status")?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, [castDone]);

	// ---- claims (existing claim-everything mutation; per-type claims live on /rewards) ----
	const claimAll = useClaimAllRewards();

	// ---- first-epoch path ----
	const { data: positions } = useAllPositions();
	const { data: positionList } = usePositions(positions);
	const posByPool = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const pos of positionList ?? []) {
			const key = pos.getData().solve.toString();
			m.set(key, [...(m.get(key) ?? []), pos.getAddress().toString()]);
		}
		return m;
	}, [positionList]);
	const hasPosition = (positions?.length ?? 0) > 0;
	const hasLock = (locks?.length ?? 0) > 0;
	const hasVoted = Boolean(locks?.some((l) => l.used)) || hasVotedThisEpoch;
	const baseDone = [hasPosition || hasLock || hasVoted, hasPosition || hasVoted, hasVoted];
	const jd = INTENTS_ENABLED ? [baseDone[0], ...baseDone] : baseDone;
	const jDone = jd.filter(Boolean).length;
	const journey = [
		...(INTENTS_ENABLED ? ([["Fund your wallet", "Bring SOL or USDC from any chain.", "/fund"]] as const) : []),
		["Swap", "Trade two tokens on a live pool.", "/swap"],
		["Add liquidity", "Deposit into a contender and earn its trading fees.", "/liquidity/create"],
		["Lock and vote", "Lock SOLV3, then point your votes at a pool.", "/lock"],
	] as const;

	// ---- rows ----
	const sorted = useMemo(() => {
		const key = { share: "share", tvl: "tvlUsd", bribes: "bribesUsd", fees: "feesUsd", total: "rewardsUsd" }[sort] as keyof ArenaRow;
		return [...rows].sort((a, b) => (b[key] as number) - (a[key] as number) || b.share - a.share);
	}, [rows, sort]);
	const ranked = useMemo(() => new Map([...rows].sort((a, b) => b.share - a.share).map((r, i) => [r.addr, i + 1])), [rows]);
	const shown = comm ? sorted.filter((r) => !r.core) : sorted;
	const top3 = [...rows].sort((a, b) => b.share - a.share).slice(0, 3);
	const topComm = [...rows].filter((r) => !r.core).sort((a, b) => b.share - a.share).slice(0, 3);
	const picked = voteState.map((v) => {
		const addr = v.getAddress().toString();
		const i = rows.findIndex((r) => r.addr === addr);
		return { addr, name: `${v.tokenAInfo.symbol}/${v.tokenBInfo.symbol}`, pct: v.votePercent, color: PALETTE[(i < 0 ? 0 : i) % PALETTE.length] };
	});

	const emission = epoch > 0 ? epochEmission(epoch) : undefined;
	const ringColor = isClosed ? "#A6A4B8" : phase === "closing-soon" ? "#F5B14C" : "#8C84FF";
	const C = 2 * Math.PI * 84;
	const ringMid = !clock ? "—" : isClosed ? (settling ? "Settling" : "Closed") : phase === "closing-soon" ? formatDuration(toCutoff).replace(/^00:/, "") : `${Math.floor(toCutoff / 86400)}d ${Math.floor((toCutoff % 86400) / 3600)}h`;
	const ringBot = !clock ? "Reading chain clock" : isClosed ? `Epoch ${epoch + 1} starts in ${formatDuration(toEnd)}` : phase === "closing-soon" ? "until voting closes" : "until voting closes";

	const reviewLabel = !connected
		? "Connect wallet to vote"
		: isClosed
			? "Voting closed"
			: !voteCast?.canVote && locks && locks.length === 0
				? "Lock SOLV3 to vote"
				: total === 0
					? "Pick pools to vote"
					: isPending
						? "Confirm in wallet…"
						: `Review votes (${picked.length})`;
	const reviewOff = connected && (isClosed || total === 0 || !voteCast?.canCast);

	const gError = Boolean(error);

	return (
		<>
			<section className="ar-hero" aria-label="Epoch Arena">
				<div className="waves" aria-hidden="true">
					<svg viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0 70 C100 40 200 100 300 70 S500 40 600 70 S800 100 900 70 S1100 40 1200 70 V120 H0Z" fill="rgba(104,93,247,.10)" /></svg>
					<svg viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0 85 C120 60 180 110 300 85 S480 60 600 85 S780 110 900 85 S1080 60 1200 85 V120 H0Z" fill="rgba(88,215,255,.07)" /></svg>
				</div>
				<div className="ar-top">
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						<h1 style={{ fontSize: "clamp(36px, 4.4vw, 56px)", lineHeight: 1.02, letterSpacing: "-0.035em", fontWeight: 700 }}>Epoch Arena</h1>
						<p style={{ fontSize: 17, lineHeight: 1.55, color: "#C9C7D6", maxWidth: 560 }}>
							Back the pools you want to grow. Vote with your veSOLV3, add liquidity to the contenders, and claim what they earn.
						</p>
						<div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
							<Link className="btn2 pri" href="/liquidity/create">Add liquidity</Link>
							<Link className="btn2" href="/lock">Get voting power</Link>
						</div>
					</div>
					<div className="ar-ring" style={{ justifySelf: "end" }}>
						<div role="img" aria-label="Epoch progress ring" style={{ position: "relative", width: 196, height: 196 }}>
							<svg viewBox="0 0 196 196" width="196" height="196" aria-hidden="true" style={{ display: "block" }}>
								<circle cx="98" cy="98" r="84" fill="none" stroke="rgba(246,245,249,.10)" strokeWidth="10" />
								<circle cx="98" cy="98" r="84" fill="none" stroke={ringColor} strokeWidth="10" strokeLinecap="round" transform="rotate(-90 98 98)" style={{ strokeDasharray: `${(C * frac).toFixed(1)} ${C.toFixed(1)}`, transition: "stroke-dasharray .6s ease" }} />
							</svg>
							<div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, textAlign: "center", padding: "0 28px" }}>
								<span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "#A6A4B8" }}>EPOCH {epoch || "—"}</span>
								<span style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: isClosed ? "#F6F5F9" : "#F5B14C" }}>{ringMid}</span>
								<span style={{ fontSize: 12, fontWeight: 500, color: "#C9C7D6", lineHeight: 1.3 }}>{ringBot}</span>
							</div>
						</div>
					</div>
				</div>
				<div className="ar-stats">
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>TVL</span><span className="dv" style={{ fontSize: 22 }}>{late ? <TvlValue /> : "…"}</span></div>
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>24h Volume</span><span className="dv" style={{ fontSize: 22 }}>—</span><span style={{ fontSize: 11.5, color: "#A6A4B8" }}>Not indexed yet</span></div>
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>24h Trading Fees</span><span className="dv" style={{ fontSize: 22 }}>—</span><span style={{ fontSize: 11.5, color: "#A6A4B8" }}>Not indexed yet</span></div>
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>Emission this epoch</span><span className="dv" style={{ fontSize: 22 }}>{emission ? `${num(emission)} SOLV3` : "—"}</span><span style={{ fontSize: 11.5, color: "#A6A4B8" }}>{Math.round(GAUGE_EMISSION_SHARE * 100)}% to gauges</span></div>
				</div>
			</section>

			{rows.length > 0 && (
				<section className="ar-card" aria-label={isClosed ? "Epoch winners" : "Current leaders"} style={{ gap: 20 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
						<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
							<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#F5B14C" }}>{isClosed ? `EPOCH ${epoch} FINAL TALLY` : `EPOCH ${epoch} · LEADING NOW`}</span>
							<h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Top 3 pools</h2>
						</div>
						<span style={{ fontSize: 13, color: "#A6A4B8" }}>{isClosed ? "By gauge vote share" : "By gauge vote share so far. Votes can still change until voting closes."}</span>
					</div>
					<div className="pod">
						{top3.map((r, k) => (
							<div key={r.addr} className="rise" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px", borderRadius: 14, background: "#141428", border: "1px solid rgba(246,245,249,0.10)", borderTop: `3px solid ${["#F5B14C", "#C9C7D6", "#C9742B"][k]}`, animationDelay: `${k * 120}ms` }}>
								<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: ["#F5B14C", "#C9C7D6", "#C9742B"][k] }}>{["1ST", "2ND", "3RD"][k]}</span>
								<span style={{ fontSize: 20, fontWeight: 700 }}>{r.name}</span>
								<span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13, color: "#A6A4B8" }}><TagChip core={r.core} /><span className="dv" style={{ fontSize: 16 }}>{r.share.toFixed(1)}%</span></span>
							</div>
						))}
					</div>
					{topComm.length > 0 && (
						<>
							<div style={{ height: 1, background: "rgba(246,245,249,0.10)" }} />
							<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
								<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#58D7FF" }}>COMMUNITY SPOTLIGHT</span>
								<h2 style={{ fontSize: 22, fontWeight: 700 }}>Top 3 community pools</h2>
							</div>
							<div className="pod">
								{topComm.map((r, k) => (
									<div key={r.addr} className="rise" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px", borderRadius: 14, background: k === 0 ? "linear-gradient(135deg, rgba(88,215,255,0.16), rgba(104,93,247,0.20))" : "#141428", border: `1px solid ${k === 0 ? "rgba(88,215,255,0.5)" : "rgba(246,245,249,0.10)"}`, animationDelay: `${k * 120 + 360}ms` }}>
										<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: k === 0 ? "#58D7FF" : "#A6A4B8" }}>{k === 0 ? "COMMUNITY WINNER" : k === 1 ? "COMMUNITY 2ND" : "COMMUNITY 3RD"}</span>
										<span style={{ fontSize: 20, fontWeight: 700 }}>{r.name}</span>
										<span style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#A6A4B8" }}><span>Overall #{ranked.get(r.addr)}</span><span className="dv" style={{ fontSize: 16 }}>{r.share.toFixed(1)}%</span></span>
									</div>
								))}
							</div>
						</>
					)}
				</section>
			)}

			{connected && jDone < jd.length && (
				<section aria-label="Your first epoch" className="ar-card" style={{ gap: 14 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
						<h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Your first epoch</h2>
						<span style={{ fontSize: 13, color: "#A6A4B8" }}>{jDone} of {jd.length} done</span>
					</div>
					<div style={{ height: 6, borderRadius: 4, background: "#1B1B36", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(jDone / jd.length) * 100}%`, background: "#685DF7", borderRadius: 4 }} /></div>
					<div className="jr">
						{journey.map(([t, d, href], i) => {
							const done = jd[i];
							const now = !done && jd.slice(0, i).every(Boolean);
							return (
								<Link key={t} href={href} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 16, borderRadius: 14, textDecoration: "none", minHeight: 44, background: now ? "rgba(104,93,247,0.14)" : "#141428", border: `1px solid ${now ? "#8C84FF" : "rgba(246,245,249,0.10)"}` }}>
									<span style={{ width: 28, height: 28, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: done ? "#7BE0A8" : now ? "#685DF7" : "#1B1B36", color: done ? "#07130d" : "#fff" }}>{done ? "✓" : i + 1}</span>
									<span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
										<span style={{ fontSize: 15, fontWeight: 700, color: "#F6F5F9" }}>{t}</span>
										<span style={{ fontSize: 13, color: "#C9C7D6", lineHeight: 1.4 }}>{d}</span>
									</span>
								</Link>
							);
						})}
					</div>
				</section>
			)}

			{phase === "closing-soon" && (
				<Note tone="amber"><b>Voting closes soon.</b> Voting closes in <span className="dv">{formatDuration(toCutoff)}</span>, five minutes before the epoch ends. Votes cast now count for this epoch.</Note>
			)}
			{isClosed && clock && (
				<Note tone="grey"><b>Voting is closed for the end of Epoch {epoch}.</b> {settling ? "The epoch is settling; " : ""}Epoch {epoch + 1} starts in <span className="dv">{formatDuration(toEnd)}</span> (Thursday 00:00 UTC) and voting reopens then. Liquidity and swaps are not affected.</Note>
			)}

			<ol className="ar-track" aria-label="Epoch phases" style={{ listStyle: "none", margin: 0, padding: 0 }}>
				{[
					["1", "Epoch starts", "Thursday 00:00 UTC"],
					["2", "Voting", "Allocate veSOLV3 to pools"],
					["3", "Final minutes: closed", "Weights fixed, epoch keeps running"],
					["4", "Next epoch", "Starts right away, voting reopens"],
				].map(([n, t, d], i) => {
					const cur = isClosed ? 2 : 1;
					const done = i < cur;
					const now = i === cur;
					return (
						<li key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", borderRadius: 14, background: now ? "rgba(104,93,247,0.14)" : "#0E0E1C", border: `1px solid ${now ? "#8C84FF" : "rgba(246,245,249,0.10)"}` }}>
							<span style={{ width: 26, height: 26, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: done ? "#7BE0A8" : now ? "#685DF7" : "#1B1B36", color: done ? "#07130d" : "#fff" }}>{done ? "✓" : n}</span>
							<span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
								<span style={{ fontSize: 14, fontWeight: 700 }}>{t}</span>
								<span style={{ fontSize: 12.5, color: "#A6A4B8", lineHeight: 1.4 }}>{d}</span>
							</span>
						</li>
					);
				})}
			</ol>

			<div className="ar-main">
				<section aria-label="Pools" style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
						<h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Contenders</h2>
						<div role="group" aria-label="Sort pools" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							{([["share", "Vote share"], ["tvl", "TVL"], ["bribes", "Incentives"], ["fees", "Fees"], ["total", "Total rewards"]] as const).map(([k, l]) => (
								<button key={k} type="button" className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>
							))}
							<button type="button" className="chip" aria-pressed={comm} onClick={() => setComm((c) => !c)} style={{ borderColor: "rgba(88,215,255,0.5)" }}>Community only</button>
						</div>
					</div>
					<p style={{ fontSize: 13, color: "#A6A4B8", lineHeight: 1.5 }}>
						Ranked by gauge vote share for this epoch. Step a vote up or down in {STEP}% increments, type an exact percentage, or use Max to fill what is left. Incentives and fee rewards go to voters, not LPs.
					</p>

					{!connected && (
						<p role="note" style={{ fontSize: 13, lineHeight: 1.5, color: "#C9C7D6", background: "rgba(88,215,255,0.07)", border: "1px solid rgba(88,215,255,0.25)", borderRadius: 12, padding: "10px 14px" }}>
							You can explore and draft votes now. Connect a wallet with a veSOLV3 lock to submit them.
						</p>
					)}
					{connected && locks && locks.length === 0 && (
						<p role="note" style={{ fontSize: 13, lineHeight: 1.5, color: "#C9C7D6", background: "rgba(245,177,76,0.08)", border: "1px solid rgba(245,177,76,0.35)", borderRadius: 12, padding: "10px 14px" }}>
							This wallet has no veSOLV3 lock, so it can't vote yet. <Link href="/lock">Lock SOLV3 →</Link>
						</p>
					)}
					{isLoading && !gError && cached && cached.rows.length > 0 && (
						<>
							<div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#C9C7D6", background: "rgba(88,215,255,0.07)", border: "1px solid rgba(88,215,255,0.25)", borderRadius: 12, padding: "10px 14px" }}>
								<span className="live" />
								<span>Showing what you last saw ({Math.max(1, Math.round((Date.now() - cached.t) / 60000))} min ago). Updating from Solana; voting unlocks when it finishes.</span>
							</div>
							{cached.rows.map((r, i) => (
								<article key={r.addr} className="ar-row" aria-label={`${r.name} (last seen)`} style={{ opacity: 0.8 }}>
									<div className="ar-row-h">
										<span style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flex: "none", background: "#141428", color: "#C9C7D6" }}>{i + 1}</span>
										<span style={{ display: "flex", alignItems: "center" }} aria-hidden="true"><TokenDot sym={r.symA} logo={r.logoA} /><TokenDot sym={r.symB} logo={r.logoB} second /></span>
										<div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 160px" }}>
											<span style={{ fontSize: 18, fontWeight: 700 }}>{r.name}</span>
											<span style={{ fontSize: 12.5, color: "#A6A4B8" }}>Fee tier {r.feePct.toFixed(2)}% · Pool <span className="dv">{short(r.addr)}</span></span>
										</div>
										<TagChip core={r.core} />
									</div>
									<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
										<div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#A6A4B8" }}><span>Gauge vote share</span><span className="dv">{r.share.toFixed(1)}%</span></div>
										<div style={{ height: 10, borderRadius: 6, background: "#1B1B36", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.min(100, r.share)}%`, borderRadius: 6, background: "linear-gradient(90deg,#685DF7,#8C84FF)" }} /></div>
										<div className="ar-stats-in"><span>TVL <span className="dv">{compactUsd(r.tvlUsd)}</span></span><span>Votes <span className="dv">{num(r.votes)}</span></span><span>Est. SOLV3 <span className="dv">{r.estSolv3 > 0 ? num(r.estSolv3) : "—"}</span></span></div>
									</div>
								</article>
							))}
						</>
					)}
					{isLoading && !gError && !(cached && cached.rows.length > 0) && (
						<div role="status" aria-live="polite" className="ar-card" style={{ gap: 14 }}>
							<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
								<span className="live" />
								<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
									<span style={{ fontSize: 15, fontWeight: 700 }}>Reading gauge accounts</span>
									<span style={{ fontSize: 13, color: "#A6A4B8" }}>Synchronizing the current epoch and pool vote weights from Solana.</span>
								</div>
							</div>
							{[0, 1, 2].map((i) => <div key={i} style={{ height: 74, borderRadius: 14, background: "#141428" }} />)}
						</div>
					)}
					{gError && (
						<div role="alert" className="ar-card" style={{ gap: 12, borderColor: "rgba(255,107,129,0.45)" }}>
							<span style={{ fontSize: 15, fontWeight: 700, color: "#FF6B81" }}>Could not read gauges</span>
							<span style={{ fontSize: 13.5, lineHeight: 1.5, color: "#C9C7D6" }}>Solana data could not be read. Missing data is not a zero vote or reward balance. Your votes and rewards are unchanged.</span>
							<button type="button" className="btn2" onClick={retry} style={{ alignSelf: "flex-start", cursor: "pointer", fontFamily: "inherit" }}>Retry</button>
						</div>
					)}
					{!isLoading && !gError && rows.length === 0 && (
						<div className="ar-card"><span style={{ fontSize: 15, fontWeight: 700 }}>No active gauges</span><span style={{ fontSize: 13.5, color: "#C9C7D6" }}>No pools are eligible for votes in this epoch. Check again after the next gauge activation.</span></div>
					)}

					{!isLoading && !gError && shown.map((r) => {
						const v = draftOf(r.addr);
						const others = total - v;
						const rank = ranked.get(r.addr) ?? 0;
						const disabled = isClosed;
						const info = r.info.getData();
						return (
							<article key={r.addr} className="ar-row" aria-label={r.name}>
								<div className="ar-row-h">
									<span style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flex: "none", ...(rank <= 3 ? { background: "linear-gradient(135deg,#685DF7,#8C84FF)", color: "#fff" } : { background: "#141428", color: "#C9C7D6" }) }}>{rank}</span>
									<span style={{ display: "flex", alignItems: "center" }} aria-hidden="true"><TokenDot sym={r.symA} logo={r.logoA} /><TokenDot sym={r.symB} logo={r.logoB} second /></span>
									<div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 160px" }}>
										<span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>{r.name}</span>
										<span style={{ fontSize: 12.5, color: "#A6A4B8", display: "flex", flexWrap: "wrap", gap: "0 8px" }}><span>Fee tier {r.feePct.toFixed(2)}%</span><span style={{ whiteSpace: "nowrap" }}>Pool <span className="dv" title={r.addr}>{short(r.addr)}</span></span></span>
									</div>
									<TagChip core={r.core} />
									{accelerated.get(r.addr) && <AccelChip epochs={accelerated.get(r.addr)?.epochsRemaining ?? 0} />}
								</div>
								<div className="ar-row-b">
									<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
										<div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#A6A4B8" }}><span>Gauge vote share</span><span className="dv">{r.share.toFixed(1)}%</span></div>
										<div style={{ height: 10, borderRadius: 6, background: "#1B1B36", overflow: "hidden", position: "relative" }}>
											<span style={{ display: "block", height: "100%", width: `${Math.min(100, r.share)}%`, borderRadius: 6, background: "linear-gradient(90deg,#685DF7,#8C84FF)", position: "absolute", left: 0, top: 0 }} />
											{v > 0 && <span style={{ display: "block", position: "absolute", top: 0, bottom: 0, left: `${Math.min(100, r.share)}%`, width: `${Math.min(v / 2, 100 - Math.min(100, r.share))}%`, background: "#58D7FF", borderRadius: "0 6px 6px 0", opacity: 0.85 }} />}
										</div>
										<div className="ar-stats-in"><span>TVL <span className="dv">{compactUsd(r.tvlUsd)}</span></span><span>Votes <span className="dv">{num(r.votes)}</span></span></div>
										<div className="vr" aria-label={`Voter rewards for ${r.name}`}>
											<div><span>Emission APR</span><span className="dv">{late ? <EmissionAprText addr={r.addr} /> : "…"}</span></div>
											<div><span>Est. SOLV3</span><span className="dv">{r.estSolv3 > 0 ? num(r.estSolv3) : "—"}</span></div>
											<div><span>Total rewards</span><span className="dv">{compactUsd(r.rewardsUsd)}</span><span style={{ fontSize: 11, color: "#A6A4B8" }}>Fees + incentives</span></div>
											<div><span>Incentives</span><span className="dv">{compactUsd(r.bribesUsd)}</span><Link href={`/bribes?pool=${r.addr}`} style={{ fontSize: 12, fontWeight: 600, textDecoration: "none", minHeight: 24 }}>Add incentives →</Link></div>
											<div><span>Fee rewards</span><span className="dv">{compactUsd(r.feesUsd)}</span></div>
										</div>
									</div>
									<div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-end" }}>
									<div style={{ display: "flex", alignItems: "center", gap: 8 }} role="group" aria-label={`Vote allocation for ${r.name}`}>
										<button type="button" className="stp" aria-label={`Decrease vote for ${r.name}`} disabled={disabled || v <= 0} onClick={() => setDraft(r, v - STEP)}>−</button>
										<input
											aria-label={`${r.name} vote percentage`}
											inputMode="numeric"
											disabled={disabled}
											value={`${v}%`}
											onChange={(e) => {
												const d = e.currentTarget.value.replace(/[^0-9]/g, "");
												setDraft(r, d === "" ? 0 : Number(d));
											}}
											style={{ width: 62, minHeight: 44, textAlign: "center", fontFamily: "inherit", fontSize: 18, fontWeight: 700, background: "#141428", border: "1px solid rgba(246,245,249,0.14)", borderRadius: 12, color: v ? "#58D7FF" : "#A6A4B8" }}
										/>
										<button type="button" className="stp" aria-label={`Max vote for ${r.name}`} disabled={disabled || 100 - others <= 0 || v >= 100 - others} onClick={() => setDraft(r, 100 - others)} style={{ width: "auto", padding: "0 12px", fontSize: 13, fontWeight: 700 }}>Max</button>
										<button type="button" className="stp" aria-label={`Increase vote for ${r.name}`} disabled={disabled || total >= 100} onClick={() => setDraft(r, v + STEP)}>+</button>
									</div>
									<div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
										{(() => {
											const ids = posByPool.get(r.addr);
											if (!ids || ids.length === 0) return null;
											return (
												<Link className="btn2" href={ids.length === 1 ? `/liquidity/manager?positionId=${ids[0]}` : `/liquidity?q=${encodeURIComponent(r.name)}`}>
													{ids.length === 1 ? "Manage position" : `Manage ${ids.length} positions`}
												</Link>
											);
										})()}
										<Link className="btn2 pri" href={`/liquidity/create?currencyA=${info.tokenMintA.toString()}&currencyB=${info.tokenMintB.toString()}&pool=manual&fee=${info.feeRate}`}>Add liquidity</Link>
									</div>
									</div>
								</div>
							</article>
						);
					})}

					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "4px 4px 0" }}>
						<span style={{ fontSize: 13, color: "#A6A4B8" }}>Showing {shown.length} gauge {shown.length === 1 ? "pool" : "pools"}.</span>
						<Link href="/liquidity/create" style={{ fontSize: 14, fontWeight: 600, textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center" }}>Create a pool →</Link>
					</div>
					<p style={{ fontSize: 12.5, lineHeight: 1.6, color: "#A6A4B8" }}>
						Emission APR is the annualized value of a gauge's SOLV3 stream against its TVL. Split up to 100% across active gauges. Pool spot prices, not real market values; historical volume and fees are not indexed. Shared chain data on this page can be up to about 30 seconds old; transactions always use live state.
					</p>
				</section>

				<aside className="ar-side" aria-label="Your Arena">
					<section className="ar-card" style={{ borderColor: "rgba(140,132,255,0.30)" }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
							<h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", color: "#A6A4B8" }}>YOUR ARENA</h2>
							<Link href="/lock" style={{ fontSize: 13, fontWeight: 600, textDecoration: "none" }}>Lock more →</Link>
						</div>
						<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
							{locks && locks.length > 0 && (
								<label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#A6A4B8" }}>
									Position
									<select
										aria-label="veSOLV3 position"
										value={lockId || ""}
										onChange={(e) => setLockId(Number(e.currentTarget.value))}
										style={{ font: "inherit", fontSize: 15, fontWeight: 600, color: "#F6F5F9", background: "#141428", border: "1px solid rgba(246,245,249,0.14)", borderRadius: 12, minHeight: 48, padding: "0 14px" }}
									>
										{locks.map((l) => <option key={l.identifier.toNumber()} value={l.identifier.toNumber()}>Lock ID #{l.identifier.toNumber()}</option>)}
									</select>
								</label>
							)}
							<div style={{ background: "#141428", borderRadius: 14, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
								<span style={{ fontSize: 13, color: "#A6A4B8" }}>Voting power</span>
								<span className="dv" style={{ fontSize: 20 }}>{connected && lock ? `${num(veBalance, 2)} veSOLV3` : "—"}</span>
							</div>
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								<div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#C9C7D6" }}>
									<span>Draft allocation</span>
									<span style={{ fontWeight: 700, color: "#F6F5F9" }}>{total}% of 100% · <span style={{ color: "#58D7FF" }}>{remaining}% left</span></span>
								</div>
								<div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, total)} style={{ display: "flex", height: 12, borderRadius: 7, background: "#1B1B36", overflow: "hidden", gap: 2 }}>
									{picked.map((p) => <span key={p.addr} style={{ display: "block", height: "100%", width: `${p.pct}%`, background: p.color }} />)}
								</div>
								{picked.length > 0 ? (
									<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
										{picked.map((p) => (
											<div key={p.addr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, minHeight: 32 }}>
												<span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, display: "block" }} />{p.name}</span>
												<span style={{ fontWeight: 700 }}>{p.pct}%</span>
											</div>
										))}
									</div>
								) : (
									<p style={{ fontSize: 13.5, color: "#A6A4B8", lineHeight: 1.5 }}>Use + on a pool to start a draft. Nothing is sent until you review and confirm.</p>
								)}
							</div>
							{hasVotedThisEpoch && picked.length > 0 && (
								<p style={{ fontSize: 12.5, lineHeight: 1.5, color: "#F5B14C" }}>This position has voted this epoch. Submitting replaces your wallet's current allocation entirely — any pool omitted here loses its allocation.</p>
							)}
							{total > 0 && total < 100 && (
								<p role="status" style={{ fontSize: 12.5, lineHeight: 1.5, color: "#F5B14C" }}>You have allocated {total}% of this position's voting power. The other {remaining}% will not earn any rewards this epoch.</p>
							)}
							{connected && locks && locks.length === 0 ? (
								<Link className="btn2 pri" href="/lock" style={{ minHeight: 52, borderRadius: 14, fontSize: 16 }}>Lock SOLV3 to vote</Link>
							) : (
							<button
								type="button"
								disabled={reviewOff}
								onClick={() => (connected ? setReview(true) : setOpenModal(ModalType.WALLET))}
								style={{ font: "inherit", fontSize: 16, fontWeight: 600, border: 0, minHeight: 52, borderRadius: 14, cursor: reviewOff ? "not-allowed" : "pointer", background: reviewOff ? "#1B1B36" : "#685DF7", color: reviewOff ? "#A6A4B8" : "#fff" }}
							>
								{reviewLabel}
							</button>
							)}
							<div style={{ display: "flex", gap: 10 }}>
								<button type="button" className="btn2" disabled={picked.length === 0} onClick={resetVoteState} style={{ flex: 1, cursor: "pointer", fontFamily: "inherit" }}>Reset</button>
								<button
									type="button"
									className="btn2"
									disabled={!connected || !voteCast?.canVote || !canVoteNow || isPending || revoteBusy || !previousVote || previousVote.votes.length === 0}
									onClick={() => void handleRevote()}
									title="Vote last epoch's allocation again in one step"
									style={{ flex: 1, cursor: "pointer", fontFamily: "inherit" }}
								>
									{revoteBusy ? "Loading…" : "Revote"}
								</button>
							</div>
							{revoteNote && <p role="status" style={{ fontSize: 12.5, lineHeight: 1.5, color: "#C9C7D6" }}>{revoteNote}</p>}
							{publicKey && lock && epoch > 0 && voteState.some((item) => item.vote && item.votePercent > 0) && (
								<div className="dre"><DraftRewardEstimate epoch={epoch} lockId={lockId} power={lock.lockPower} draft={voteState} /></div>
							)}
							<div id="vote-status">
								{isPending && <TransactionStatus status="pending" title="Approve and confirm your vote" description="Keep this window open while the wallet request is submitted and confirmed on Solana." />}
								{voteCast?.isSuccess && voteCast.data && (
									<TransactionStatus status="success" title="Vote recorded on-chain" description={`Votes submitted for Epoch ${epoch}. Your gauge allocation is now part of this epoch's vote.`} signature={voteCast.data} explorerUrl={getExpolerUrl(network, voteCast.data, "tx")} />
								)}
								{transactionError && <TransactionStatus status="error" title="Vote not submitted" description={transactionError.message} details={transactionError.raw} />}
							</div>
							<p style={{ fontSize: 12.5, lineHeight: 1.5, color: "#A6A4B8" }}>Voting power is your locked veSOLV3. Quest XP does not add votes. <Link href="/lock/auto-vote">Auto-vote →</Link></p>
						</div>

						<div style={{ height: 1, background: "rgba(246,245,249,0.10)" }} />
						<h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", color: "#A6A4B8" }}>CLAIMS</h2>
						<button
							type="button"
							disabled={!connected || claimAll.isPending}
							onClick={() => claimAll.mutate()}
							style={{ font: "inherit", fontSize: 15, fontWeight: 600, border: 0, minHeight: 48, borderRadius: 12, cursor: !connected || claimAll.isPending ? "not-allowed" : "pointer", background: !connected || claimAll.isPending ? "#1B1B36" : "#685DF7", color: !connected || claimAll.isPending ? "#A6A4B8" : "#fff" }}
						>
							{claimAll.isPending ? "Claiming…" : connected ? "Claim all rewards" : "Connect wallet to claim"}
						</button>
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							{([["LP trading fees", "Fees and incentives from your liquidity positions", "/rewards"], ["Voter rewards", "Fees and incentives for the gauges you voted", "/rewards?method=vote"]] as const).map(([t, d, href]) => (
								<div className="claim" key={t}>
									<span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
										<span style={{ fontSize: 14, fontWeight: 600 }}>{t}</span>
										<span style={{ fontSize: 12.5, color: "#A6A4B8" }}>{d}</span>
									</span>
									<Link href={href} className="btn2" style={{ minHeight: 44, padding: "0 14px", fontSize: 13 }}>Open</Link>
								</div>
							))}
						</div>
						<p style={{ fontSize: 12.5, lineHeight: 1.5, color: "#A6A4B8" }}>Rewards for votes in epoch N are claimable from epoch N+1. Claim all sends each LP position and each voted gauge separately; the Rewards page claims them one at a time.</p>
					</section>
					<Link href="/quests" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textDecoration: "none", background: "#0E0E1C", border: "1px solid rgba(246,245,249,0.10)", borderRadius: 16, padding: "14px 18px", color: "#F6F5F9", minHeight: 44 }}>
						<span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
							<span style={{ fontSize: 14, fontWeight: 700 }}>Genesis XP &amp; quests</span>
							<span style={{ fontSize: 12.5, color: "#A6A4B8" }}>Separate from voting power</span>
						</span>
						<span style={{ color: "#8C84FF", fontWeight: 600, fontSize: 14 }}>Quests →</span>
					</Link>
				</aside>
			</div>

			{!isLoading && !gError && <LiquidityOnlyPools exclude={new Set(rows.map((r) => r.addr))} />}

			<Flywheel />

			{total > 0 && !review && (
				<div className="vbar" role="region" aria-label="Draft votes">
					<span><b>{total}%</b> allocated · {remaining}% left</span>
					<button type="button" onClick={() => (connected ? (reviewOff ? undefined : setReview(true)) : setOpenModal(ModalType.WALLET))} disabled={connected && reviewOff}>
						{connected ? "Review votes" : "Connect wallet"}
					</button>
				</div>
			)}

			{review && (
				<div
					style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(4,4,12,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
					onKeyDown={(e) => e.key === "Escape" && setReview(false)}
				>
					<div role="dialog" aria-modal="true" aria-label="Review votes" style={{ width: "100%", maxWidth: 460, background: "#0E0E1C", border: "1px solid rgba(140,132,255,0.35)", borderRadius: 20, padding: 24, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 30px 80px -10px rgba(0,0,0,0.8)" }}>
						<h2 style={{ fontSize: 20, fontWeight: 700 }}>Review votes for Epoch {epoch}</h2>
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							{picked.map((p) => (
								<div key={p.addr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#141428", borderRadius: 12, padding: "12px 14px", fontSize: 15 }}>
									<span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, display: "block" }} />{p.name}</span>
									<span style={{ fontWeight: 700 }}>{p.pct}%</span>
								</div>
							))}
						</div>
						<div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#C9C7D6" }}><span>Total allocated</span><span style={{ fontWeight: 700, color: "#F6F5F9" }}>{total}%</span></div>
						<p style={{ fontSize: 13, lineHeight: 1.55, color: "#A6A4B8" }}>This replaces your wallet's whole allocation for this epoch. Voting closes five minutes before the epoch ends, and rewards from these votes are claimable from epoch N+1. Confirm in your wallet to submit.</p>
						<div style={{ display: "flex", gap: 10 }}>
							<button type="button" autoFocus onClick={() => setReview(false)} style={{ flex: 1, font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 48, borderRadius: 12, border: "1px solid rgba(246,245,249,0.16)", background: "#141428", color: "#F6F5F9", cursor: "pointer" }}>Cancel</button>
							<button type="button" onClick={() => { setReview(false); voteCast?.cast("panel"); }} style={{ flex: 1.4, font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 48, borderRadius: 12, border: 0, background: "#685DF7", color: "#fff", cursor: "pointer" }}>Confirm in wallet</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
};

/* ------------------------------------------------------------------ Lite profile (no gauges yet) ------------------------------------------------------------------ */

type LitePoolRow = { addr: string; symA: string; symB: string; logoA?: string; logoB?: string; fee: number; mintA: string; mintB: string; feeRate: number; tvl: number };

/** Every DEX pool with its TVL, largest first. Pools are read once per page and shared with the TVL stat. */
const usePoolRows = () => {
	const tokenMap = useAllTokens();
	const proto = useProtocolTvl();
	const rows: LitePoolRow[] = useMemo(() => {
		return (proto.pools ?? [])
			.map((pool) => {
				const d = pool.getData();
				const a = tokenMap[d.tokenMintA.toBase58()];
				const b = tokenMap[d.tokenMintB.toBase58()];
				const px = (mint: string) => proto.breakdown.find((e) => e.address === mint)?.price ?? 0;
				const decA = pool.getTokenAInfo().decimals;
				const decB = pool.getTokenBInfo().decimals;
				const tvl =
					(Number(pool.getTokenVaultAInfo().amount.toString()) / 10 ** decA) * px(d.tokenMintA.toBase58()) +
					(Number(pool.getTokenVaultBInfo().amount.toString()) / 10 ** decB) * px(d.tokenMintB.toBase58());
				return {
					addr: pool.getAddress().toString(),
					symA: a?.symbol ?? short(d.tokenMintA.toBase58()),
					symB: b?.symbol ?? short(d.tokenMintB.toBase58()),
					logoA: a?.logoURI,
					logoB: b?.logoURI,
					fee: d.feeRate / 10_000,
					mintA: d.tokenMintA.toString(),
					mintB: d.tokenMintB.toString(),
					feeRate: d.feeRate,
					tvl,
				};
			})
			.sort((x, y) => y.tvl - x.tvl);
	}, [proto.pools, proto.breakdown, tokenMap]);
	return { rows, proto };
};

const PoolRow: React.FC<{ r: LitePoolRow; i: number; totalTvl: number }> = ({ r, i, totalTvl }) => (
	<article key={r.addr} className="ar-row" aria-label={`${r.symA}/${r.symB}`}>
		<div className="ar-row-h">
			<span style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, background: "#141428", color: "#C9C7D6" }}>{i + 1}</span>
			<span style={{ display: "flex" }} aria-hidden="true"><TokenDot sym={r.symA} logo={r.logoA} /><TokenDot sym={r.symB} logo={r.logoB} second /></span>
			<div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 160px" }}>
				<span style={{ fontSize: 18, fontWeight: 700 }}>{r.symA}/{r.symB}</span>
				<span style={{ fontSize: 12.5, color: "#A6A4B8" }}>Fee tier {r.fee.toFixed(2)}% · Pool <span className="dv" title={r.addr}>{short(r.addr)}</span></span>
			</div>
			<div style={{ display: "flex", gap: 10 }}>
				<Link className="btn2" href="/liquidity">Manage</Link>
				<Link className="btn2 pri" href={`/liquidity/create?currencyA=${r.mintA}&currencyB=${r.mintB}&pool=manual&fee=${r.feeRate}`}>Add liquidity</Link>
			</div>
		</div>
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			<div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#A6A4B8" }}><span>Share of total TVL</span><span className="dv">{totalTvl > 0 ? `${((r.tvl / totalTvl) * 100).toFixed(1)}%` : "—"} · {compactUsd(r.tvl)}</span></div>
			<div style={{ height: 10, borderRadius: 6, background: "#1B1B36", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${totalTvl > 0 ? (r.tvl / totalTvl) * 100 : 0}%`, background: "#58D7FF", borderRadius: 6 }} /></div>
		</div>
	</article>
);

/** Pools that have no gauge yet (or none in this epoch): liquidity only, no votes or emissions. */
const LiquidityOnlyPools: React.FC<{ exclude: ReadonlySet<string> }> = ({ exclude }) => {
	const { rows, proto } = usePoolRows();
	const list = rows.filter((r) => !exclude.has(r.addr));
	const totalTvl = rows.reduce((s, r) => s + r.tvl, 0);
	if (proto.poolsLoading || list.length === 0) return null;
	return (
		<section aria-label="Liquidity-only pools" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
			<h2 style={{ fontSize: 22, fontWeight: 700 }}>Liquidity-only pools</h2>
			<p style={{ fontSize: 13, color: "#A6A4B8" }}>These pools have no gauge this epoch, so they get no votes or emissions. They still earn trading fees, and you can add liquidity.</p>
			{list.map((r, i) => (
				<PoolRow key={r.addr} r={r} i={i} totalTvl={totalTvl} />
			))}
		</section>
	);
};

const ArenaLite: React.FC = () => {
	const { rows, proto } = usePoolRows();
	const [error] = useState(false);
	const totalTvl = rows.reduce((s, r) => s + r.tvl, 0);
	return (
		<>
			<section className="ar-hero" aria-label="Epoch Arena">
				<div className="ar-top" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						<h1 style={{ fontSize: "clamp(36px, 4.4vw, 56px)", lineHeight: 1.02, letterSpacing: "-0.035em", fontWeight: 700 }}>Epoch Arena</h1>
						<p style={{ fontSize: 17, lineHeight: 1.55, color: "#C9C7D6", maxWidth: 560 }}>Provide liquidity and earn trading fees. Gauge voting and emissions switch on at Full Launch.</p>
						<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><Link className="btn2 pri" href="/liquidity/create">Add liquidity</Link></div>
					</div>
				</div>
				<div className="ar-stats three">
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>TVL</span><span className="dv" style={{ fontSize: 22 }}>{compactUsd(proto.tvl)}</span></div>
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>24h Volume</span><span className="dv" style={{ fontSize: 22 }}>—</span><span style={{ fontSize: 11.5, color: "#A6A4B8" }}>Not indexed yet</span></div>
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>24h Trading Fees</span><span className="dv" style={{ fontSize: 22 }}>—</span><span style={{ fontSize: 11.5, color: "#A6A4B8" }}>Not indexed yet</span></div>
				</div>
			</section>
			<Note tone="cyan"><b>Lite Launch.</b> Swaps and liquidity are live. Gauge voting, epoch emissions and bribes switch on at Full Launch, so this page ranks pools by TVL until then.</Note>
			<section aria-label="Pools" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
				<h2 style={{ fontSize: 22, fontWeight: 700 }}>Pools</h2>
				<p style={{ fontSize: 13, color: "#A6A4B8" }}>Ranked by TVL. Pick a pool to add liquidity or manage a position.</p>
				{proto.poolsLoading && <div role="status" className="ar-card"><span className="live" /> Reading pools…</div>}
				{(proto.poolsError || error) && <div role="alert" className="ar-card" style={{ borderColor: "rgba(255,107,129,0.45)" }}><b style={{ color: "#FF6B81" }}>Could not read pools</b></div>}
				{rows.map((r, i) => (
					<PoolRow key={r.addr} r={r} i={i} totalTvl={totalTvl} />
				))}
			</section>
			<Flywheel />
		</>
	);
};

export const Arena: React.FC = () => {
	if (DEX_ONLY || GENESIS_PUBLIC_ENABLED) return <ArenaLite />;
	return (
		<VoteProvider>
			<VoteCastProvider>
				<ArenaFull />
			</VoteCastProvider>
		</VoteProvider>
	);
};
