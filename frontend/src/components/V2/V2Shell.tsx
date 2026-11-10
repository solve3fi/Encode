"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type PropsWithChildren, Suspense, useEffect, useState } from "react";
import { AUDIT_URL } from "@/configs/audit";
import { INTENTS_ENABLED } from "@/configs/intents";
import { formatDuration } from "@/lib/format";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { useVoteConfig } from "@/stores/vote/hooks/useVoteConfig";
import { getEpochClockState } from "../Vote/epochClock";
import { DEX_ONLY } from "@/configs/launchPhase";
import { ProtocolContext } from "../Layout/ProtocolContext";
import { DevnetBanner } from "../ProtocolStatus/DevnetBanner";
import { WaveBackground } from "../WaveBackground";
import { CommandBar } from "../CommandBar";
import { FlowCards } from "./FlowStrip";
import { WalletConnect } from "../Wallet";
import "./v2.css";

const MORE: ReadonlyArray<readonly [string, string]> = [
	["Lock", "/lock"],
	["Genesis", "/genesis"],
	["Flywheel", "/simulator"],
	["Bribes", "/bribes"],
	["Airdrop", "/airdrop"],
	["Presale", "/presale"],
	["Charter", "/charter"],
	...(INTENTS_ENABLED ? ([["Fund from any chain", "/fund"]] as const) : []),
	["Pools", "/liquidity"],
	["Clans", "/quests?tab=clans"],
	["Create a pool", "/liquidity/create"],
	["Request a token listing", "/liquidity/request-token"],
	["Vote (advanced)", "/vote"],
	["ALM (beta)", "/beta/alm-market"],
	["Yield Hunter (beta)", "/beta/yield-hunter"],
	["Classic site (v1)", "/v1/swap"],
];

/** The main (mainnet) site keeps More short: only pages that are live there, nothing gated or preview. */
const MORE_MAIN: ReadonlyArray<readonly [string, string]> = [
	["Pools", "/liquidity"],
	...(INTENTS_ENABLED ? ([["Fund from any chain", "/fund"]] as const) : []),
	["Flywheel simulator", "/simulator"],
	["Charter", "/charter"],
	["Partners", "/partners"],
];

const icon = (d: string) => (
	<svg
		viewBox="0 0 24 24"
		width="20"
		height="20"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d={d} />
	</svg>
);

const MoreMenu: React.FC<{ onNavigate: () => void; items: ReadonlyArray<readonly [string, string]> }> = ({ onNavigate, items }) => (
	<div className="menu">
		{items.map(([label, href]) => (
			<Link key={href} href={href} onClick={onNavigate}>
				<span>{label}</span>
			</Link>
		))}
	</div>
);

/** Clock chip: "Epoch N" over the live countdown to the vote cutoff (data from the same chain read the classic header uses). */
const ClockChip: React.FC = () => {
	const { network } = useCluster();
	const { data } = useVoteConfig(network);
	const [now, setNow] = useState(0);
	useEffect(() => {
		const tick = () => setNow(Date.now());
		tick();
		const id = window.setInterval(tick, 1000);
		return () => window.clearInterval(id);
	}, []);
	let top = "Epoch —";
	let bot = "Reading chain clock";
	if (data && now) {
		const chainNow = Math.floor(data.chainTime + (now - data.localTimeAtFetch) / 1000);
		const state = getEpochClockState(data.nextEpochTime, chainNow);
		top = `Epoch ${data.epoch.toString()}`;
		const toEnd = data.nextEpochTime - chainNow;
		bot =
			state === "open"
				? `Voting closes in ${formatDuration(toEnd - 300)}`
				: state === "final-hour"
					? `Voting paused · epoch ends in ${formatDuration(toEnd)}`
					: "Epoch settling";
	}
	return (
		<span
			className="dchip"
			title="Chain clock"
			style={{
				fontSize: 13,
				fontWeight: 600,
				padding: "0 14px",
				minHeight: 44,
				borderRadius: 10,
				background: "rgba(88,215,255,0.08)",
				border: "1px solid rgba(88,215,255,0.28)",
				color: "#58D7FF",
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				lineHeight: 1.25,
			}}
		>
			<span style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 11 }}>{top}</span>
			<span>{bot}</span>
		</span>
	);
};

/** Lite Launch has no epoch clock; say so instead of showing a chain countdown. */
const LiteChip: React.FC = () => (
	<span
		className="dchip"
		title="Chain clock"
		style={{ fontSize: 13, fontWeight: 600, padding: "0 14px", minHeight: 44, borderRadius: 10, background: "rgba(88,215,255,0.08)", border: "1px solid rgba(88,215,255,0.28)", color: "#58D7FF", display: "flex", flexDirection: "column", justifyContent: "center", lineHeight: 1.25 }}
	>
		<span style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 11 }}>Lite Launch</span>
		<span>Swaps and liquidity live</span>
	</span>
);

export const V2Shell: React.FC<PropsWithChildren> = ({ children }) => {
	const pathname = usePathname();
	const path = (pathname ?? "").replace(/^\/en(?=\/|$)/, "") || "/";
	const onArena = /^\/arena(\/demo)?\/?$/.test(path);
	const isDemo = /^\/arena\/demo\/?$/.test(path);
	const isAt = (r: string) => path === `/${r}` || path.startsWith(`/${r}/`);
	// The working pages share an epoch strip above them and the Quests and clan cards below.
	const flowContext =
		isAt("swap") ? "Swap"
		: isAt("bribes") ? "Add incentives"
		: isAt("lock") ? "Lock"
		: path.startsWith("/liquidity/create") ? "Add liquidity"
		: path.startsWith("/liquidity/manager") ? "Manage position"
		: null;
	const { network } = useCluster();
	const moreItems = network === ClusterNetwork.Mainnet ? MORE_MAIN : MORE;
	const [menuKey, setMenuKey] = useState(0);
	const close = () => setMenuKey((k) => k + 1); // remounts <details> closed

	const navLink = (href: string, label: string, on: boolean) => (
		<Link
			href={href}
			aria-current={on ? "page" : undefined}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				textDecoration: "none",
				minHeight: 44,
				color: on ? "#8C84FF" : "#C9C7D6",
				fontWeight: on ? 700 : 500,
			}}
		>
			{label}
		</Link>
	);

	return (
		<div
			className="s3v2"
			style={{ background: "#070711", color: "#F6F5F9", minHeight: "100vh", position: "relative", isolation: "isolate" }}
		>
			<WaveBackground />
			<header style={{ borderBottom: "1px solid rgba(246,245,249,0.08)", position: "relative" }}>
				<nav
					aria-label="App"
					className="dhead"
					style={{
						maxWidth: 1240,
						margin: "0 auto",
						padding: "12px 24px",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 20,
						flexWrap: "wrap",
					}}
				>
					<div className="dhead-left" style={{ display: "flex", alignItems: "center", gap: 36 }}>
						<Link href="/" aria-label="Solve3 home" style={{ display: "flex", alignItems: "center" }}>
							{/* biome-ignore lint/performance/noImgElement: static brand logo */}
							<img src="/assets/images/solve-logo.svg" width={110} height={30} alt="Solve3" style={{ display: "block" }} />
						</Link>
						<div
							className="dnav"
							style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap", fontSize: 15 }}
						>
							{navLink("/swap", "Swap", isAt("swap"))}
							{navLink("/arena", "Arena", onArena)}
							{navLink("/quests", "Quests", isAt("quests"))}
							{navLink("/rewards", "Wallet", isAt("rewards"))}
							<details className="more" key={menuKey}>
								<summary style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, color: "#C9C7D6", fontWeight: 500 }}>
									More
									<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
										<path d="M6 9l6 6 6-6" />
									</svg>
								</summary>
								<MoreMenu onNavigate={close} items={moreItems} />
							</details>
						</div>
					</div>
					<div className="dhead-right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
						{!isDemo && (DEX_ONLY ? <LiteChip /> : <ClockChip />)}
						<span
						className="dsol"
							style={{
								fontSize: 14,
								fontWeight: 600,
								padding: "0 16px",
								minHeight: 44,
								borderRadius: 10,
								background: "#0E0E1C",
								border: "1px solid rgba(246,245,249,0.10)",
								display: "flex",
								alignItems: "center",
								gap: 8,
							}}
						>
							<span style={{ width: 8, height: 8, borderRadius: "50%", background: "#58D7FF" }} />
							Solana
						</span>
						{!isDemo && <CommandBar />}
						{!isDemo && <WalletConnect />}
					</div>
				</nav>
			</header>
			<div style={{ position: "relative" }}>
			<DevnetBanner />
			</div>
			{!onArena && <ProtocolContext />}
			<main
				className={onArena ? "v2-arena ar-scope" : undefined}
				style={onArena ? {
					position: "relative",
					maxWidth: 1240,
					margin: "0 auto",
					padding: "40px 24px 96px",
					display: "flex",
					flexDirection: "column",
					gap: 28,
				} : { padding: flowContext ? "12px 0 48px" : "32px 0 64px", position: "relative" }}
			>
				<Suspense fallback={null}>{children}</Suspense>
				{flowContext && <FlowCards />}
			</main>
			<footer style={{ borderTop: "1px solid rgba(246,245,249,0.08)", position: "relative" }}>
				<div
					style={{
						maxWidth: 1240,
						margin: "0 auto",
						padding: "32px 24px",
						display: "flex",
						justifyContent: "space-between",
						gap: 24,
						flexWrap: "wrap",
						fontSize: 14,
						color: "#A6A4B8",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
						<span>© {new Date().getFullYear()} Solve3</span>
						<a
							href={AUDIT_URL}
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Audited by LedgerOps"
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 9,
								padding: "6px 14px 6px 10px",
								border: "1px solid rgba(246,245,249,0.14)",
								borderRadius: 99,
								background: "#0E0E1C",
								textDecoration: "none",
								color: "#C9C7D6",
								fontSize: 12.5,
								fontWeight: 600,
								whiteSpace: "nowrap",
							}}
						>
							<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#58D7FF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z" />
								<path d="M8.5 12l2.5 2.5 4.5-5" />
							</svg>
							<span>Audited by</span>
							{/* biome-ignore lint/performance/noImgElement: static footer badge */}
							<img src="/assets/ledgerops-logo.png" alt="LedgerOps" style={{ display: "block", height: 13, width: "auto" }} />
						</a>
					</div>
					<div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
						{(
							[
								["Charter", "/charter"],
								["Quests", "/quests"],
								["Brand kit", "/brand"],
								["Privacy", "/privacy"],
								["Legal", "/legal"],
								["Terms", "/term"],
							] as const
						).map(([l, h]) => (
							<Link key={h} href={h} style={{ color: "#A6A4B8", textDecoration: "none" }}>
								{l}
							</Link>
						))}
						<a href={AUDIT_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#A6A4B8", textDecoration: "none" }}>
							Audit
						</a>
						<a href="https://x.com/solve3fi" style={{ color: "#A6A4B8", textDecoration: "none" }}>X</a>
						<a href="https://discord.gg/ZDyXeyjGc7" style={{ color: "#A6A4B8", textDecoration: "none" }}>Discord</a>
						<a href="https://github.com/solve3fi" style={{ color: "#A6A4B8", textDecoration: "none" }}>GitHub</a>
					</div>
				</div>
			</footer>
			<nav className="mbar" aria-label="Primary">
				<Link href="/swap" className={isAt("swap") ? "on" : undefined}>
					{icon("M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4")}
					<span>Swap</span>
				</Link>
				<Link href="/arena" className={onArena ? "on" : undefined}>
					{icon("M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3z")}
					<span>Arena</span>
				</Link>
				<Link href="/quests" className={isAt("quests") ? "on" : undefined}>
					{icon("M5 21V4m0 0h11l-1.5 4L16 12H5")}
					<span>Quests</span>
				</Link>
				<Link href="/rewards" className={isAt("rewards") ? "on" : undefined}>
					{icon("M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7zm0 0V6a2 2 0 0 1 2-2h11M16 14h.01")}
					<span>Wallet</span>
				</Link>
				<details className="more" key={`m${menuKey}`}>
					<summary>
						<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
							<circle cx="5" cy="12" r="1.2" />
							<circle cx="12" cy="12" r="1.2" />
							<circle cx="19" cy="12" r="1.2" />
						</svg>
						<span>More</span>
					</summary>
					<MoreMenu onNavigate={close} items={moreItems} />
				</details>
			</nav>
		</div>
	);
};
