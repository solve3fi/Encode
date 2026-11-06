"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { INTENTS_ENABLED } from "@/configs/intents";
import { AccelChip, Flywheel, Note, TagChip, TokenDot, compactUsd, num } from "./Arena";

/**
 * Static demo of the Epoch Arena for recorded walkthroughs. No chain reads and no wallet: every value below is invented
 * sample data and the page says so. A control bar switches launch profile, epoch phase, wallet, gauge loading state and
 * first-epoch progress, and the voting, review, submit, revote and claim flows all work on the sample data.
 */

type Profile = "full" | "lite";
type Phase = "open" | "closing-soon" | "closed";
type Gauges = "ready" | "loading" | "error";

const parseUsd = (s: string) => {
	const n = parseFloat(s.replace(/[$,]/g, ""));
	return /M/.test(s) ? n * 1e6 : /K/.test(s) ? n * 1e3 : n;
};

const money2 = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
const clock = (s: number) => {
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = Math.floor(s % 60);
	const pad = (x: number) => String(x).padStart(2, "0");
	return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : h > 0 ? `${h}h ${pad(m)}m ${pad(sec)}s` : `${m}m ${pad(sec)}s`;
};

/** Flashes green or red for a moment when its numeric value goes up or down. */
const Tick: React.FC<{ value: number; children: React.ReactNode }> = ({ value, children }) => {
	const [prev, setPrev] = useState(value);
	const [dir, setDir] = useState<0 | 1 | -1>(0);
	useEffect(() => {
		if (value === prev) return;
		setDir(value > prev ? 1 : -1);
		setPrev(value);
		const t = window.setTimeout(() => setDir(0), 700);
		return () => window.clearTimeout(t);
	}, [value, prev]);
	return <span style={{ transition: "color .5s, text-shadow .5s", color: dir === 1 ? "#7BE0A8" : dir === -1 ? "#FF8FA3" : undefined, textShadow: dir ? `0 0 12px ${dir === 1 ? "rgba(123,224,168,.55)" : "rgba(255,143,163,.5)"}` : "none" }}>{children}</span>;
};

const Spark: React.FC<{ data: number[] }> = ({ data }) => {
	const w = 96;
	const h = 28;
	const min = Math.min(...data);
	const max = Math.max(...data);
	const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - min) / (max - min || 1)) * (h - 6)}`).join(" ");
	const up = data[data.length - 1] >= data[0];
	return (
		<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: "block", flex: "none" }}>
			<polyline points={pts} fill="none" stroke={up ? "#7BE0A8" : "#FF8FA3"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
			<circle cx={w} cy={h - 3 - ((data[data.length - 1] - min) / (max - min || 1)) * (h - 6)} r="2.5" fill={up ? "#7BE0A8" : "#FF8FA3"} />
		</svg>
	);
};

const POOLS = [
	{ a: "SOLV3", b: "SOL", fee: 0.3, tvl: "$5.6M", vol: "$1.9M", fees: "$5.7K", share: 31, tvlShare: "30.4%", addr: "7xKp…q3Zt", apr: "88%", bribes: "$3,200", vfees: "$38.2K", total: "$41.4K" },
	{ a: "SOLV3", b: "USDC", fee: 0.3, tvl: "$4.1M", vol: "$1.4M", fees: "$4.2K", share: 22, tvlShare: "22.3%", addr: "9mRd…4wLe", apr: "104%", bribes: "$2,100", vfees: "$27.9K", total: "$30.0K" },
	{ a: "SOL", b: "USDC", fee: 0.05, tvl: "$3.2M", vol: "$2.2M", fees: "$1.1K", share: 17, tvlShare: "17.4%", addr: "Fh2c…Vn8a", apr: "61%", bribes: "$450", vfees: "$7.4K", total: "$7.9K" },
	{ a: "WIF3", b: "SOLV3", fee: 1, tvl: "$2.5M", vol: "$120K", fees: "$1.2K", share: 14, tvlShare: "13.6%", addr: "3bQy…Tz5u", apr: "212%", bribes: "$4,800", vfees: "$8.1K", total: "$12.9K" },
	{ a: "JUP", b: "SOL", fee: 0.3, tvl: "$1.7M", vol: "$450K", fees: "$1.4K", share: 9, tvlShare: "9.2%", addr: "Ck6s…Hp1r", apr: "143%", bribes: "$1,900", vfees: "$9.0K", total: "$10.9K" },
	{ a: "BONK", b: "SOL", fee: 1, tvl: "$1.3M", vol: "$130K", fees: "$1.3K", share: 7, tvlShare: "7.1%", addr: "Jd9w…Mx4n", apr: "176%", bribes: "$2,600", vfees: "$7.8K", total: "$10.4K" },
	{ a: "NOOT", b: "USDC", fee: 0.3, tvl: "$1.1M", vol: "$610K", fees: "$1.8K", share: 12, tvlShare: "5.9%", addr: "AueG…aWH3", apr: "198%", bribes: "$1,450", vfees: "$6.2K", total: "$7.7K" },
	{ a: "MCAT", b: "USDC", fee: 1, tvl: "$840K", vol: "$520K", fees: "$5.2K", share: 9, tvlShare: "4.5%", addr: "7U5v…wB4j", apr: "231%", bribes: "$980", vfees: "$5.1K", total: "$6.1K" },
	{ a: "WAGMI", b: "SOL", fee: 0.3, tvl: "$760K", vol: "$330K", fees: "$1.0K", share: 8, tvlShare: "4.1%", addr: "ceFR…tHAG", apr: "167%", bribes: "$1,200", vfees: "$4.4K", total: "$5.6K" },
	{ a: "PNUT", b: "USDC", fee: 0.3, tvl: "$690K", vol: "$280K", fees: "$840", share: 6, tvlShare: "3.7%", addr: "6cvY…dRFc", apr: "144%", bribes: "$640", vfees: "$3.1K", total: "$3.7K" },
	{ a: "FROGE", b: "SOL", fee: 1, tvl: "$520K", vol: "$410K", fees: "$4.1K", share: 5, tvlShare: "2.8%", addr: "9BiY…uump", apr: "259%", bribes: "$770", vfees: "$3.6K", total: "$4.4K" },
].map((p) => ({
	...p,
	name: `${p.a}/${p.b}`,
	core: ["SOL", "USDC", "SOLV3"].includes(p.a) && ["SOL", "USDC", "SOLV3"].includes(p.b),
	w: p.share,
	accel: p.a === "MCAT" ? 3 : p.a === "PNUT" ? 1 : 0,
	tvlN: parseUsd(p.tvl),
	volN: parseUsd(p.vol),
	feesN: parseUsd(p.fees),
}));
const LOGOS: Record<string, string> = { MCAT: "/assets/tokens/mcat.svg", FROGE: "/assets/tokens/froge.svg", NOOT: "/assets/tokens/noot.svg", PNUT: "/assets/tokens/pnut.svg", WAGMI: "/assets/tokens/wagmi.svg" };
const EVENT_USERS = ["7xKp…q3Zt", "Fh2c…Vn8a", "9mRd…4wLe", "Ck6s…Hp1r", "3bQy…Tz5u", "Jd9w…Mx4n", "HGUP…sq6o", "2qDQ…3nGk"];

const PALETTE = ["#8C84FF", "#58D7FF", "#7BE0A8", "#F5B14C", "#FF8FB1", "#B3ADFF"];
const EPOCH = 12;
const emissionFor = (n: number) => 1_300_000 * 0.98 ** (n - 1);

const Seg: React.FC<{ label: string; value: string; opts: [string, string][]; on: (v: string) => void }> = ({ label, value, opts, on }) => (
	<span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
		<span style={{ fontSize: 13, color: "#A6A4B8" }}>{label}</span>
		{opts.map(([v, l]) => (
			<button key={v} type="button" className="chip" aria-pressed={value === v} onClick={() => on(v)}>
				{l}
			</button>
		))}
	</span>
);

export const ArenaDemo: React.FC = () => {
	const [profile, setProfile] = useState<Profile>("full");
	const [phase, setPhase] = useState<Phase>("open");
	const [connected, setConnected] = useState(false);
	const [gauges, setGauges] = useState<Gauges>("ready");
	const [journey, setJourney] = useState(0);
	const [alloc, setAlloc] = useState<Record<string, number>>({});
	const [sort, setSort] = useState<"share" | "tvl" | "vol" | "fees">("share");
	const [comm, setComm] = useState(false);
	const [review, setReview] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [claimed, setClaimed] = useState<Record<string, boolean>>({});

	const [live, setLive] = useState(true);
	const [hideControls, setHideControls] = useState(false);
	const [secsLeft, setSecsLeft] = useState(3 * 86400 + 14 * 3600 + 2 * 60);
	const [hist, setHist] = useState<number[][]>(() => POOLS.map((p, i) => Array.from({ length: 24 }, (_, k) => p.volN * (0.8 + 0.2 * (k / 23) + 0.06 * Math.sin(k / 2.2 + i)))));
	const [drift, setDrift] = useState(() => POOLS.map((p) => ({ tvl: p.tvlN, vol: p.volN, fees: p.feesN, w: p.w })));
	const [events, setEvents] = useState<{ id: number; kind: string; text: string; t: string }[]>([]);
	const lite = profile === "lite";
	const closed = !lite && phase === "closed";
	const finalHour = !lite && phase === "closing-soon";
	const canVote = !lite && !closed;
	const locked = submitted || gauges !== "ready";
	const total = Object.values(alloc).reduce((a, b) => a + b, 0);
	const remaining = 100 - total;

	const reset = () => {
		setProfile("full"); setPhase("open"); setConnected(false); setGauges("ready"); setJourney(0);
		setAlloc({}); setSort("share"); setComm(false); setReview(false); setSubmitted(false); setClaimed({});
	};
	const setPct = (id: string, pct: number) =>
		setAlloc((cur) => {
			const others = Object.entries(cur).reduce((a, [k, v]) => a + (k === id ? 0 : v), 0);
			const next = Math.max(0, Math.min(Math.round(pct), 100 - others));
			const copy = { ...cur };
			if (next === 0) delete copy[id]; else copy[id] = next;
			return copy;
		});

	const pools = useMemo(() => {
		const totalW = drift.reduce((a, d) => a + d.w, 0);
		const totalTvl = drift.reduce((a, d) => a + d.tvl, 0);
		return POOLS.map((p, i) => ({
			...p,
			tvlN: drift[i].tvl,
			volN: drift[i].vol,
			feesN: drift[i].fees,
			share: (drift[i].w / totalW) * 100,
			tvlShare: `${((drift[i].tvl / totalTvl) * 100).toFixed(1)}%`,
			tvl: compactUsd(drift[i].tvl),
			vol: compactUsd(drift[i].vol),
			fees: compactUsd(drift[i].fees),
		}));
	}, [drift]);
	const totals = useMemo(
		() => ({ tvl: drift.reduce((a, d) => a + d.tvl, 0), vol: drift.reduce((a, d) => a + d.vol, 0), fees: drift.reduce((a, d) => a + d.fees, 0) }),
		[drift],
	);

	// Lively sample data: numbers drift a little and a feed of invented events scrolls while "Live" is on.
	useEffect(() => {
		if (!live) return;
		let n = 0;
		const id = window.setInterval(() => {
			setHist((cur) => cur.map((h, i) => [...h.slice(1), h[h.length - 1] * (1 + (Math.random() - 0.42) * 0.035)]));
			setDrift((cur) =>
				cur.map((d) => ({
					tvl: d.tvl * (1 + (Math.random() - 0.45) * 0.006),
					vol: d.vol * (1 + Math.random() * 0.012),
					fees: d.fees * (1 + Math.random() * 0.012),
					w: Math.max(1, d.w * (1 + (Math.random() - 0.48) * 0.02)),
				})),
			);
			const p = POOLS[Math.floor(Math.random() * POOLS.length)];
			const who = EVENT_USERS[Math.floor(Math.random() * EVENT_USERS.length)];
			const r = Math.random();
			const amt = Math.round(Math.exp(Math.log(180) + 1.1 * (Math.random() + Math.random() - 1)));
			const e =
				r < 0.55
					? { kind: "Swap", text: `${who} swapped ${num(amt)} ${Math.random() < 0.5 ? p.a : p.b} in ${p.name}` }
					: r < 0.75
						? { kind: "Liquidity", text: `${who} added $${num(amt * 6)} to ${p.name}` }
						: r < 0.9
							? { kind: "Vote", text: `${who} voted ${[5, 10, 20, 25, 50][Math.floor(Math.random() * 5)]}% for ${p.name}` }
							: { kind: "Fees", text: `${p.name} accrued $${num(Math.max(2, Math.round(amt / 25)))} in trading fees` };
			n += 1;
			setEvents((cur) => [{ id: Date.now() + n, ...e, t: new Date().toISOString().slice(11, 19) }, ...cur].slice(0, 6));
		}, 2400);
		return () => window.clearInterval(id);
	}, [live]);

	// the epoch clock counts down once a second while live; changing phase resets it to a matching value
	useEffect(() => {
		setSecsLeft(phase === "open" ? 3 * 86400 + 14 * 3600 + 2 * 60 : phase === "closing-soon" ? 52 * 60 + 14 : 41 * 60 + 9);
	}, [phase]);
	useEffect(() => {
		if (!live) return;
		const id = window.setInterval(() => setSecsLeft((v) => Math.max(0, v - 1)), 1000);
		return () => window.clearInterval(id);
	}, [live]);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.key === "h" || e.key === "H") && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) setHideControls((v) => !v);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const rows = useMemo(() => {
		const key = lite ? (sort === "share" ? "tvl" : sort) : sort;
		const v = (p: (typeof pools)[number]) => (key === "share" ? p.share : key === "tvl" ? p.tvlN : key === "vol" ? p.volN : p.feesN);
		return [...pools].sort((x, y) => v(y) - v(x));
	}, [sort, lite, pools]);
	const ranked = new Map([...pools].sort((x, y) => y.share - x.share).map((p, i) => [p.name, i + 1]));
	const shown = comm ? rows.filter((r) => !r.core) : rows;
	const picked = pools.map((p, i) => ({ ...p, pct: alloc[p.name] ?? 0, color: PALETTE[i % PALETTE.length] })).filter((p) => p.pct > 0);
	const top3 = [...pools].sort((x, y) => y.share - x.share).slice(0, 3);
	const topComm = pools.filter((p) => !p.core).sort((x, y) => y.share - x.share).slice(0, 3);

	const claimsDone = claimed.c1 && claimed.c2 && claimed.c3;
	const C = 2 * Math.PI * 84;
	const frac = closed ? 0.994 : finalHour ? 0.97 : 0.5;
	const ringColor = lite ? "rgba(246,245,249,0.22)" : closed ? "#A6A4B8" : finalHour ? "#F5B14C" : "#8C84FF";
	const ringTop = lite ? "LITE LAUNCH" : `EPOCH ${EPOCH}`;
	const ringMid = lite ? "No clock" : closed ? "Closed" : clock(secsLeft);
	const ringBot = lite ? "Epochs start at Full Launch" : closed ? `Epoch ${EPOCH + 1} starts in ${clock(secsLeft)}` : "until voting closes";

	const reviewLabel = lite ? "Voting starts at Full Launch" : !connected ? "Connect wallet to vote" : closed ? "Voting closed" : total === 0 ? "Pick pools to vote" : submitted ? "Votes submitted" : `Review votes (${picked.length})`;
	const reviewOff = lite || (connected && (closed || total === 0 || submitted));
	const jDefs = [...(INTENTS_ENABLED ? [["Fund your wallet", "Bring SOL or USDC from any chain.", "/fund"]] : []), ["Swap", "Trade two tokens on a live pool.", "/swap"], ["Add liquidity", "Deposit into a contender and earn its trading fees.", "/liquidity/create"], ...(lite ? [] : [["Lock and vote", "Lock SOLV3, then point your votes at a pool.", "/lock"]])] as [string, string, string][];
	const jTotal = jDefs.length;
	const jd = Math.min(journey, jTotal);

	return (
		<>
			{hideControls ? (
				<button type="button" onClick={() => setHideControls(false)} aria-label="Show demo controls" style={{ position: "fixed", right: 12, bottom: 12, zIndex: 80, font: "inherit", fontSize: 12, padding: "6px 12px", borderRadius: 99, border: "1px solid rgba(245,177,76,0.4)", background: "rgba(7,7,17,0.7)", color: "#F5B14C", opacity: 0.25, cursor: "pointer" }}>Controls (H)</button>
			) : (
			<div role="group" aria-label="Demo controls" style={{ display: "flex", gap: "10px 18px", flexWrap: "wrap", alignItems: "center", border: "1.5px dashed rgba(245,177,76,0.55)", background: "rgba(245,177,76,0.05)", borderRadius: 14, padding: "10px 16px" }}>
				<span className="ph" style={{ fontSize: 12, letterSpacing: "0.08em" }}>DEMO CONTROLS</span>
				<Seg label="Launch" value={profile} on={(v) => { setProfile(v as Profile); setSort(v === "lite" ? "tvl" : "share"); }} opts={[["full", "Full"], ["lite", "Lite"]]} />
				{!lite && <Seg label="Phase" value={phase} on={(v) => setPhase(v as Phase)} opts={[["open", "Voting open"], ["closing-soon", "Closing soon"], ["closed", "Voting closed"]]} />}
				<Seg label="First-epoch steps done" value={String(jd)} on={(v) => setJourney(Number(v))} opts={Array.from({ length: jTotal + 1 }, (_, i) => [String(i), i === 0 ? "None" : String(i)] as [string, string])} />
				<Seg label="Wallet" value={connected ? "on" : "off"} on={(v) => setConnected(v === "on")} opts={[["off", "Disconnected"], ["on", "Connected"]]} />
				{!lite && <Seg label="Gauges" value={gauges} on={(v) => setGauges(v as Gauges)} opts={[["ready", "Ready"], ["loading", "Loading"], ["error", "Error"]]} />}
				<Seg label="Live activity" value={live ? "on" : "off"} on={(v) => setLive(v === "on")} opts={[["on", "On"], ["off", "Off"]]} />
				<button type="button" className="chip" onClick={() => setHideControls(true)}>Hide controls (H)</button>
				<button type="button" className="chip" onClick={reset}>Reset</button>
			</div>
			)}

			<section className="ar-hero" aria-label="Epoch Arena">
				<div className="waves" aria-hidden="true">
					<svg viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0 70 C100 40 200 100 300 70 S500 40 600 70 S800 100 900 70 S1100 40 1200 70 V120 H0Z" fill="rgba(104,93,247,.10)" /></svg>
					<svg viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0 85 C120 60 180 110 300 85 S480 60 600 85 S780 110 900 85 S1080 60 1200 85 V120 H0Z" fill="rgba(88,215,255,.07)" /></svg>
				</div>
				<div className="ar-top" style={lite ? { gridTemplateColumns: "minmax(0,1fr) 196px" } : undefined}>
					<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
						<span style={{ alignSelf: "flex-start", padding: "3px 10px", borderRadius: 99, background: "rgba(245,177,76,0.14)", border: "1px solid rgba(245,177,76,0.45)", color: "#F5B14C", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>DEMO DATA</span>
						<h1 style={{ fontSize: "clamp(36px, 4.4vw, 56px)", lineHeight: 1.02, letterSpacing: "-0.035em", fontWeight: 700 }}>Epoch Arena</h1>
						<p style={{ fontSize: 17, lineHeight: 1.55, color: "#C9C7D6", maxWidth: 560 }}>
							{lite ? "Provide liquidity and earn trading fees. Gauge voting and emissions switch on at Full Launch." : "Back the pools you want to grow. Vote with your veSOLV3, add liquidity to the contenders, and claim what they earn."}
						</p>
						<div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
							<Link className="btn2 pri" href="/liquidity/create">Add liquidity</Link>
							{!lite && <Link className="btn2" href="/lock">Get voting power</Link>}
						</div>
					</div>
					<div className="ar-ring" style={{ justifySelf: "end" }}>
						<div role="img" aria-label="Epoch progress ring" style={{ position: "relative", width: 196, height: 196 }}>
							<svg viewBox="0 0 196 196" width="196" height="196" aria-hidden="true" style={{ display: "block" }}>
								<circle cx="98" cy="98" r="84" fill="none" stroke="rgba(246,245,249,.10)" strokeWidth="10" />
								<circle cx="98" cy="98" r="84" fill="none" stroke={ringColor} strokeWidth="10" strokeLinecap="round" transform="rotate(-90 98 98)" style={{ strokeDasharray: lite ? "6 8" : `${(C * frac).toFixed(1)} ${C.toFixed(1)}`, transition: "stroke-dasharray .6s ease" }} />
							</svg>
							<div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, textAlign: "center", padding: "0 28px" }}>
								<span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "#A6A4B8" }}>{ringTop}</span>
								<span style={{ fontSize: lite ? 24 : 28, fontWeight: 700, lineHeight: 1.1, color: closed || lite ? "#F6F5F9" : "#F5B14C" }}>{ringMid}</span>
								<span style={{ fontSize: 12, fontWeight: 500, color: "#C9C7D6", lineHeight: 1.3 }}>{ringBot}</span>
							</div>
						</div>
					</div>
				</div>
				<div className={lite ? "ar-stats three" : "ar-stats"}>
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>TVL</span><span className="dv" style={{ fontSize: 22 }}><Tick value={totals.tvl}>{money2(totals.tvl)}</Tick></span></div>
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>24h Volume</span><span className="dv" style={{ fontSize: 22 }}><Tick value={totals.vol}>{money2(totals.vol)}</Tick></span></div>
					<div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>24h Trading Fees</span><span className="dv" style={{ fontSize: 22 }}><Tick value={totals.fees}>{money2(totals.fees)}</Tick></span></div>
					{!lite && <div className="ar-stat"><span style={{ fontSize: 12, color: "#A6A4B8" }}>Emission this epoch</span><span className="dv" style={{ fontSize: 22 }}>{num(emissionFor(EPOCH))} SOLV3</span><span style={{ fontSize: 11.5, color: "#A6A4B8" }}>96% to gauges</span></div>}
				</div>
			</section>

			{!lite && (
				<div className="proof" role="note">
					<span style={{ fontWeight: 700, color: "#F6F5F9" }}>Last epoch ({EPOCH - 1})</span>
					<span><span className="dv">1,062,190</span> SOLV3 emitted</span>
					<span><span className="dv">$98.4K</span> in trading fees to voters</span>
					<span><span className="dv">31</span> pools funded</span>
				</div>
			)}

			{events.length > 0 && (
				<section className="ar-card" aria-label="Live activity" style={{ gap: 10, padding: "16px 20px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<span className="live" />
						<span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: "#A6A4B8" }}>LIVE ACTIVITY · SAMPLE</span>
					</div>
					{events.map((e) => (
						<div key={e.id} className="rise" style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 14, minHeight: 28 }}>
							<span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: e.kind === "Vote" ? "rgba(140,132,255,0.18)" : e.kind === "Fees" ? "rgba(123,224,168,0.14)" : e.kind === "Liquidity" ? "rgba(88,215,255,0.14)" : "#1B1B36", color: e.kind === "Vote" ? "#B3ADFF" : e.kind === "Fees" ? "#7BE0A8" : e.kind === "Liquidity" ? "#58D7FF" : "#C9C7D6", minWidth: 68, textAlign: "center" }}>{e.kind}</span>
							<span style={{ flex: 1, minWidth: 0 }}>{e.text}</span>
							<time style={{ fontSize: 12, color: "#A6A4B8" }}>{e.t}</time>
						</div>
					))}
				</section>
			)}

			{(closed || !lite) && (
				<section className="ar-card" aria-label={closed ? "Epoch winners" : "Current leaders"} style={{ gap: 20 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
						<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
							<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#F5B14C" }}>{closed ? `EPOCH ${EPOCH} FINAL TALLY` : `EPOCH ${EPOCH} · LEADING NOW`}</span>
							<h2 style={{ fontSize: 22, fontWeight: 700 }}>Top 3 pools</h2>
						</div>
						<span style={{ fontSize: 13, color: "#A6A4B8" }}>{closed ? "By gauge vote share" : "By gauge vote share so far. Votes can still change until voting closes."}</span>
					</div>
					<div className="pod">
						{top3.map((r, k) => (
							<div key={r.name} className="rise" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px", borderRadius: 14, background: "#141428", border: "1px solid rgba(246,245,249,0.10)", borderTop: `3px solid ${["#F5B14C", "#C9C7D6", "#C9742B"][k]}`, animationDelay: `${k * 120}ms` }}>
								<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: ["#F5B14C", "#C9C7D6", "#C9742B"][k] }}>{["1ST", "2ND", "3RD"][k]}</span>
								<span style={{ fontSize: 20, fontWeight: 700 }}>{r.name}</span>
								<span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "#A6A4B8" }}><TagChip core={r.core} /><span className="dv" style={{ fontSize: 16 }}>{r.share.toFixed(1)}%</span></span>
							</div>
						))}
					</div>
					<div style={{ height: 1, background: "rgba(246,245,249,0.10)" }} />
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#58D7FF" }}>COMMUNITY SPOTLIGHT</span>
						<h2 style={{ fontSize: 22, fontWeight: 700 }}>Top 3 community pools</h2>
					</div>
					<div className="pod">
						{topComm.map((r, k) => (
							<div key={r.name} className="rise" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 18px", borderRadius: 14, background: k === 0 ? "linear-gradient(135deg, rgba(88,215,255,0.16), rgba(104,93,247,0.20))" : "#141428", border: `1px solid ${k === 0 ? "rgba(88,215,255,0.5)" : "rgba(246,245,249,0.10)"}`, animationDelay: `${k * 120 + 360}ms` }}>
								<span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: k === 0 ? "#58D7FF" : "#A6A4B8" }}>{k === 0 ? "COMMUNITY WINNER" : k === 1 ? "COMMUNITY 2ND" : "COMMUNITY 3RD"}</span>
								<span style={{ fontSize: 20, fontWeight: 700 }}>{r.name}</span>
								<span style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#A6A4B8" }}><span>Overall #{ranked.get(r.name)}</span><span className="dv" style={{ fontSize: 16 }}>{r.share.toFixed(1)}%</span></span>
							</div>
						))}
					</div>
				</section>
			)}

			{jd < jTotal && (
				<section aria-label="Your first epoch" className="ar-card" style={{ gap: 14 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
						<h2 style={{ fontSize: 20, fontWeight: 700 }}>Your first epoch</h2>
						<span style={{ fontSize: 13, color: "#A6A4B8" }}>{jd} of {jTotal} done</span>
					</div>
					<div style={{ height: 6, borderRadius: 4, background: "#1B1B36", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(jd / jTotal) * 100}%`, background: "#685DF7", borderRadius: 4 }} /></div>
					<div className="jr">
						{jDefs.map(([t, d, href], i) => {
							const done = i < jd;
							const now = i === jd;
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

			{lite && <Note tone="cyan"><b>Lite Launch.</b> Swaps and liquidity are live. Gauge voting, epoch emissions and bribes switch on at Full Launch, so this page ranks pools by TVL and trading fees until then.</Note>}
			{finalHour && <Note tone="amber"><b>Voting closes soon.</b> Voting closes in <span className="dv">{clock(secsLeft)}</span>, five minutes before the epoch ends. Votes cast now count for this epoch.</Note>}
			{closed && <Note tone="grey"><b>Voting is closed for the end of Epoch {EPOCH}.</b> Epoch {EPOCH + 1} starts in <span className="dv">{clock(secsLeft)}</span> (Thursday 00:00 UTC) and voting reopens then. Liquidity and swaps are not affected.</Note>}

			{!lite && (
				<ol className="ar-track" aria-label="Epoch phases" style={{ listStyle: "none", margin: 0, padding: 0 }}>
					{[["1", "Epoch starts", "Thursday 00:00 UTC"], ["2", "Voting", "Allocate veSOLV3 to pools"], ["3", "Final minutes: closed", "Weights fixed, epoch keeps running"], ["4", "Next epoch", "Starts right away, voting reopens"]].map(([n, t, d], i) => {
						const cur = closed ? 2 : 1;
						const done = i < cur;
						const now = i === cur;
						return (
							<li key={t} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", borderRadius: 14, background: now ? "rgba(104,93,247,0.14)" : "#0E0E1C", border: `1px solid ${now ? "#8C84FF" : "rgba(246,245,249,0.10)"}` }}>
								<span style={{ width: 26, height: 26, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: done ? "#7BE0A8" : now ? "#685DF7" : "#1B1B36", color: done ? "#07130d" : "#fff" }}>{done ? "✓" : n}</span>
								<span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}><span style={{ fontSize: 14, fontWeight: 700 }}>{t}</span><span style={{ fontSize: 12.5, color: "#A6A4B8", lineHeight: 1.4 }}>{d}</span></span>
							</li>
						);
					})}
				</ol>
			)}

			<div className="ar-main">
				<section aria-label="Pools" style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
						<h2 style={{ fontSize: 22, fontWeight: 700 }}>{lite ? "Pools" : "Contenders"}</h2>
						<div role="group" aria-label="Sort pools" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							{(lite ? [["tvl", "TVL"], ["vol", "Volume"], ["fees", "Fees"]] : [["share", "Vote share"], ["tvl", "TVL"], ["vol", "Volume"], ["fees", "Fees"]]).map(([k, l]) => (
								<button key={k} type="button" className="chip" aria-pressed={(lite && sort === "share" ? "tvl" : sort) === k} onClick={() => setSort(k as typeof sort)}>{l}</button>
							))}
							<button type="button" className="chip" aria-pressed={comm} onClick={() => setComm((c) => !c)} style={{ borderColor: "rgba(88,215,255,0.5)" }}>Community only</button>
						</div>
					</div>
					<p style={{ fontSize: 13, color: "#A6A4B8", lineHeight: 1.5 }}>
						{lite ? "Ranked by TVL. Pick a pool to add liquidity or manage a position." : "Ranked by gauge vote share for this epoch. Step a vote up or down in 5% increments, type an exact percentage, or use Max to fill what is left. Incentives and fee rewards go to voters, not LPs."}
					</p>

					{gauges === "loading" && !lite && (
						<div role="status" aria-live="polite" className="ar-card" style={{ gap: 14 }}>
							<div style={{ display: "flex", alignItems: "center", gap: 12 }}><span className="live" /><div style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 700 }}>Reading gauge accounts</span><span style={{ fontSize: 13, color: "#A6A4B8" }}>Synchronizing the current epoch and pool vote weights from Solana.</span></div></div>
							{[0, 1, 2].map((i) => <div key={i} style={{ height: 74, borderRadius: 14, background: "#141428" }} />)}
						</div>
					)}
					{gauges === "error" && !lite && (
						<div role="alert" className="ar-card" style={{ gap: 12, borderColor: "rgba(255,107,129,0.45)" }}>
							<span style={{ fontSize: 15, fontWeight: 700, color: "#FF6B81" }}>Could not read gauges</span>
							<span style={{ fontSize: 13.5, lineHeight: 1.5, color: "#C9C7D6" }}>The gauge accounts did not load. Your votes and rewards are unchanged.</span>
							<button type="button" className="btn2" onClick={() => setGauges("ready")} style={{ alignSelf: "flex-start", cursor: "pointer", fontFamily: "inherit" }}>Retry</button>
						</div>
					)}

					{(gauges === "ready" || lite) && shown.map((r) => {
						const v = alloc[r.name] ?? 0;
						const others = total - v;
						const rank = ranked.get(r.name) ?? 0;
						return (
							<article key={r.name} className="ar-row" aria-label={r.name}>
								<div className="ar-row-h">
									<span style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flex: "none", ...(rank <= 3 && !lite ? { background: "linear-gradient(135deg,#685DF7,#8C84FF)", color: "#fff" } : { background: "#141428", color: "#C9C7D6" }) }}>{lite ? rows.indexOf(r) + 1 : rank}</span>
									<span style={{ display: "flex", alignItems: "center" }} aria-hidden="true"><TokenDot sym={r.a} logo={LOGOS[r.a]} /><TokenDot sym={r.b} logo={LOGOS[r.b]} second /></span>
									<div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 160px" }}>
										<span style={{ fontSize: 18, fontWeight: 700 }}>{r.name}</span>
										<span style={{ fontSize: 12.5, color: "#A6A4B8", display: "flex", flexWrap: "wrap", gap: "0 8px" }}><span>Fee tier {r.fee.toFixed(2)}%</span><span style={{ whiteSpace: "nowrap" }}>Pool <span className="dv">{r.addr}</span></span></span>
									</div>
									<TagChip core={r.core} />
									{r.accel > 0 && <AccelChip epochs={r.accel} />}
								</div>
								<div className="ar-row-b">
									<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
										<div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#A6A4B8" }}><span>{lite ? "Share of total TVL" : "Gauge vote share"}</span><span className="dv"><Tick value={r.share}>{lite ? r.tvlShare : `${r.share.toFixed(1)}%`}</Tick></span></div>
										<div style={{ height: 10, borderRadius: 6, background: "#1B1B36", overflow: "hidden", position: "relative" }}>
											<span style={{ display: "block", height: "100%", width: `${r.share}%`, borderRadius: 6, background: lite ? "#58D7FF" : "linear-gradient(90deg,#685DF7,#8C84FF)", position: "absolute", left: 0, top: 0 }} />
											{v > 0 && <span style={{ display: "block", position: "absolute", top: 0, bottom: 0, left: `${r.share}%`, width: `${Math.min(v / 2, 100 - r.share)}%`, background: "#58D7FF", borderRadius: "0 6px 6px 0", opacity: 0.85 }} />}
										</div>
										<div className="ar-stats-in" style={{ alignItems: "center" }}><span>TVL <span className="dv"><Tick value={r.tvlN}>{r.tvl}</Tick></span></span><span>Vol 24h <span className="dv"><Tick value={r.volN}>{r.vol}</Tick></span></span><span>Fees 24h <span className="dv">{r.fees}</span></span><Spark data={hist[POOLS.findIndex((x) => x.name === r.name)]} /></div>
										{!lite && (
											<div className="vr" aria-label={`Voter rewards for ${r.name}`}>
												<div><span>Voting APR</span><span className="dv">{r.apr}</span></div>
												<div><span>Est. SOLV3</span><span className="dv">{num(Math.round(emissionFor(EPOCH) * 0.96 * r.share / 100))}</span></div>
												<div><span>Total rewards</span><span className="dv">{r.total}</span><span style={{ fontSize: 11, color: "#A6A4B8" }}>Fees + incentives</span></div>
												<div><span>Incentives</span><span className="dv">{r.bribes}</span><Link href="/bribes" style={{ fontSize: 12, fontWeight: 600, textDecoration: "none", minHeight: 24 }}>Add incentives →</Link></div>
												<div><span>Fee rewards</span><span className="dv">{r.vfees}</span></div>
											</div>
										)}
									</div>
									<div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-end" }}>
									{canVote && (
										<div style={{ display: "flex", alignItems: "center", gap: 8 }} role="group" aria-label={`Vote allocation for ${r.name}`}>
											<button type="button" className="stp" aria-label={`Decrease vote for ${r.name}`} disabled={locked || v <= 0} onClick={() => setPct(r.name, v - 5)}>−</button>
											<input aria-label={`${r.name} vote percentage`} inputMode="numeric" disabled={locked} value={`${v}%`} onChange={(e) => { const d = e.currentTarget.value.replace(/[^0-9]/g, ""); setPct(r.name, d === "" ? 0 : Number(d)); }} style={{ width: 62, minHeight: 44, textAlign: "center", fontFamily: "inherit", fontSize: 18, fontWeight: 700, background: "#141428", border: "1px solid rgba(246,245,249,0.14)", borderRadius: 12, color: v ? "#58D7FF" : "#A6A4B8" }} />
											<button type="button" className="stp" aria-label={`Max vote for ${r.name}`} disabled={locked || others >= 100} onClick={() => setPct(r.name, 100 - others)} style={{ width: "auto", padding: "0 12px", fontSize: 13, fontWeight: 700 }}>Max</button>
											<button type="button" className="stp" aria-label={`Increase vote for ${r.name}`} disabled={locked || total >= 100} onClick={() => setPct(r.name, v + 5)}>+</button>
										</div>
									)}
									<div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
										<Link className="btn2" href="/liquidity">Manage</Link>
										<Link className="btn2 pri" href="/liquidity/create">Add liquidity</Link>
									</div>
									</div>
								</div>
							</article>
						);
					})}

					<p style={{ fontSize: 13, color: "#A6A4B8" }}>Showing {shown.length} of 61 pools. Sample data; bar lengths are illustrative.</p>
									</section>

				<aside className="ar-side" aria-label="Your Arena">
					<section className="ar-card" style={{ borderColor: "rgba(140,132,255,0.30)" }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
							<h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", color: "#A6A4B8" }}>YOUR ARENA</h2>
							{!lite && <Link href="/lock" style={{ fontSize: 13, fontWeight: 600, textDecoration: "none" }}>Lock more →</Link>}
						</div>
						{!lite ? (
							<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
								<label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#A6A4B8" }}>Position
									<select aria-label="veSOLV3 position" style={{ font: "inherit", fontSize: 15, fontWeight: 600, color: "#F6F5F9", background: "#141428", border: "1px solid rgba(246,245,249,0.14)", borderRadius: 12, minHeight: 48, padding: "0 14px" }}><option>All positions</option><option>Position #1 · 12,480 veSOLV3</option><option>Position #2 · 3,100 veSOLV3</option></select>
								</label>
								<div style={{ background: "#141428", borderRadius: 14, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}><span style={{ fontSize: 13, color: "#A6A4B8" }}>Voting power</span><span className="dv" style={{ fontSize: 20 }}>{connected ? "12,480 veSOLV3" : "—"}</span></div>
								<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
									<div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#C9C7D6" }}><span>Draft allocation</span><span style={{ fontWeight: 700, color: "#F6F5F9" }}>{total}% of 100% · <span style={{ color: "#58D7FF" }}>{remaining}% left</span></span></div>
									<div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={total} style={{ display: "flex", height: 12, borderRadius: 7, background: "#1B1B36", overflow: "hidden", gap: 2 }}>{picked.map((p) => <span key={p.name} style={{ display: "block", height: "100%", width: `${p.pct}%`, background: p.color }} />)}</div>
									{picked.length > 0 ? <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{picked.map((p) => <div key={p.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, minHeight: 32 }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, display: "block" }} />{p.name}</span><span style={{ fontWeight: 700 }}>{p.pct}%</span></div>)}</div> : <p style={{ fontSize: 13.5, color: "#A6A4B8", lineHeight: 1.5 }}>Use + on a pool to start a draft. Nothing is sent until you review and confirm.</p>}
								</div>
								<button type="button" disabled={reviewOff} onClick={() => (connected ? setReview(true) : setConnected(true))} style={{ font: "inherit", fontSize: 16, fontWeight: 600, border: 0, minHeight: 52, borderRadius: 14, cursor: reviewOff ? "not-allowed" : "pointer", background: reviewOff ? "#1B1B36" : "#685DF7", color: reviewOff ? "#A6A4B8" : "#fff" }}>{reviewLabel}</button>
								<div style={{ display: "flex", gap: 10 }}>
									<button type="button" className="btn2" disabled={total === 0 || locked || !canVote} onClick={() => setAlloc({})} style={{ flex: 1, cursor: "pointer", fontFamily: "inherit" }}>Reset</button>
									<button type="button" className="btn2" disabled={!submitted || !canVote} onClick={() => setSubmitted(false)} style={{ flex: 1, cursor: "pointer", fontFamily: "inherit" }}>Revote</button>
								</div>
								{submitted && <p role="status" style={{ fontSize: 13.5, lineHeight: 1.5, color: "#7BE0A8", fontWeight: 600 }}>Votes submitted for Epoch {EPOCH}. Claim at epoch N+1.</p>}
								<p style={{ fontSize: 12.5, lineHeight: 1.5, color: "#A6A4B8" }}>Voting power is your locked veSOLV3. Quest XP does not add votes.</p>
							</div>
						) : (
							<div style={{ background: "#141428", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}><span style={{ fontSize: 15, fontWeight: 700 }}>Voting starts at Full Launch</span><span style={{ fontSize: 13.5, lineHeight: 1.5, color: "#C9C7D6" }}>Lock SOLV3 for veSOLV3, vote on gauges and claim emissions once Full Launch is on.</span></div>
						)}

						<div style={{ height: 1, background: "rgba(246,245,249,0.10)" }} />
						<h2 style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.06em", color: "#A6A4B8" }}>CLAIMS</h2>
						{!lite && <button type="button" disabled={!connected || claimsDone} onClick={() => setClaimed({ c1: true, c2: true, c3: true })} style={{ font: "inherit", fontSize: 15, fontWeight: 600, border: 0, minHeight: 48, borderRadius: 12, cursor: !connected || claimsDone ? "not-allowed" : "pointer", background: !connected || claimsDone ? "#1B1B36" : "#685DF7", color: !connected || claimsDone ? "#A6A4B8" : "#fff" }}>{claimsDone ? "All claimed" : connected ? "Claim all $60.78 + 960 SOLV3" : "Connect wallet to claim"}</button>}
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							{[["c1", "LP trading fees", "$42.18"], ...(lite ? [] : [["c2", "Voter rewards", "$18.60"], ["c3", "LP emissions", "960 SOLV3"]])].map(([k, t, amt]) => (
								<div className="claim" key={k}>
									<span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{t}</span><span className="dv" style={{ fontSize: 13 }}>{amt}</span></span>
									<button type="button" disabled={!!claimed[k] || !connected} onClick={() => setClaimed((c) => ({ ...c, [k]: true }))}>{claimed[k] ? "Claimed" : "Claim"}</button>
								</div>
							))}
						</div>
						<p style={{ fontSize: 12.5, lineHeight: 1.5, color: "#A6A4B8" }}>{lite ? "Trading fees accrue to your LP positions and are claimed from Manage." : "Vote in epoch N, claim in epoch N+1. Trading fees, voter rewards and LP emissions are claimed separately."}</p>
					</section>
					{!lite && (
						<Link href="/quests" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textDecoration: "none", background: "#0E0E1C", border: "1px solid rgba(246,245,249,0.10)", borderRadius: 16, padding: "14px 18px", color: "#F6F5F9", minHeight: 44 }}>
							<span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 700 }}>Genesis XP <span className="ph">1,250</span></span><span style={{ fontSize: 12.5, color: "#A6A4B8" }}>Separate from voting power</span></span><span style={{ color: "#8C84FF", fontWeight: 600, fontSize: 14 }}>Quests →</span>
						</Link>
					)}
				</aside>
			</div>

			<Flywheel />
			<p style={{ fontSize: 12.5, color: "#F5B14C" }}>Demo page: every number is invented sample data for a recorded walkthrough, and no wallet or chain is used.</p>

			{review && (
				<div style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(4,4,12,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onKeyDown={(e) => e.key === "Escape" && setReview(false)}>
					<div role="dialog" aria-modal="true" aria-label="Review votes" style={{ width: "100%", maxWidth: 460, background: "#0E0E1C", border: "1px solid rgba(140,132,255,0.35)", borderRadius: 20, padding: 24, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 30px 80px -10px rgba(0,0,0,0.8)" }}>
						<h2 style={{ fontSize: 20, fontWeight: 700 }}>Review votes for Epoch {EPOCH}</h2>
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{picked.map((p) => <div key={p.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#141428", borderRadius: 12, padding: "12px 14px", fontSize: 15 }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, display: "block" }} />{p.name}</span><span style={{ fontWeight: 700 }}>{p.pct}%</span></div>)}</div>
						<div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#C9C7D6" }}><span>Total allocated</span><span style={{ fontWeight: 700, color: "#F6F5F9" }}>{total}%</span></div>
						<p style={{ fontSize: 13, lineHeight: 1.55, color: "#A6A4B8" }}>These votes count for this epoch only. Voting closes five minutes before the epoch ends, and rewards from these votes are claimable from epoch N+1. Confirm in your wallet to submit.</p>
						<div style={{ display: "flex", gap: 10 }}>
							<button type="button" autoFocus onClick={() => setReview(false)} style={{ flex: 1, font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 48, borderRadius: 12, border: "1px solid rgba(246,245,249,0.16)", background: "#141428", color: "#F6F5F9", cursor: "pointer" }}>Cancel</button>
							<button type="button" onClick={() => { setReview(false); setSubmitted(true); setJourney(3); }} style={{ flex: 1.4, font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 48, borderRadius: 12, border: 0, background: "#685DF7", color: "#fff", cursor: "pointer" }}>Confirm in wallet</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
};
