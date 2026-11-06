"use client";

import {
	IconArrowsExchange,
	IconCoins,
	IconDroplet,
	IconGitBranch,
	IconGift,
	IconLock,
	IconPlayerPause,
	IconPlayerPlay,
} from "@tabler/icons-react";
import { type CSSProperties, useId, useState } from "react";
import styles from "./Flywheel.module.css";

const tracks = [
	"M270 55 H305",
	"M585 55 H620",
	"M770 100 Q865 165 795 211",
	"M630 275 H595",
	"M315 275 H280",
	"M100 225 Q5 165 85 119",
];
const icons = [
	IconLock,
	IconGitBranch,
	IconDroplet,
	IconArrowsExchange,
	IconCoins,
	IconGift,
];
const delay = (index: number) =>
	({ "--delay": `${index * 1.6}s` }) as CSSProperties;

const steps = [
	{
		title: "Lock & vote",
		short: "veSOLV3 holders choose pools",
		detail:
			"Permanent SOLV3 locks give holders voting power. Each epoch, they choose which active gauges to support. Funded partner incentives can help attract those votes.",
		role: "Voters",
	},
	{
		title: "Direct emissions",
		short: "Votes determine pool allocations",
		detail:
			"The epoch’s votes determine how the next epoch’s gauge emissions budget is allocated. Voting directs the existing budget rather than increasing total emissions.",
		role: "Protocol",
	},
	{
		title: "Attract liquidity",
		short: "SOLV3 rewards encourage LPs",
		detail:
			"Allocated SOLV3 rewards give liquidity providers a reason to deposit into a pool. LPs choose their positions and ranges. Incentives can attract liquidity, but deposits depend on their decisions.",
		role: "Liquidity providers",
	},
	{
		title: "Support trading",
		short: "Liquidity can improve execution",
		detail:
			"More usable liquidity near the trading price can reduce price impact. Better execution can attract traders. Actual volume depends on demand, prices and competing venues.",
		role: "Traders",
	},
	{
		title: "Generate fees",
		short: "Real swaps create trading fees",
		detail:
			"Swaps generate fees. For active gauges, trading fees are routed to voters. Pool fee routing depends on the pool’s effective gauge status.",
		role: "Pools",
	},
	{
		title: "Reward voters",
		short: "Fees + funded voting incentives",
		detail:
			"Voters can claim their share of trading fees and partner-funded voting incentives from the gauges they supported. Earned rewards can encourage participation in the next epoch. Reinvestment is a user choice.",
		role: "Voters",
	},
];

export function Flywheel() {
	const [selected, setSelected] = useState(0);
	const [paused, setPaused] = useState(false);
	const id = useId();
	return (
		<section
			className={styles.root}
			data-paused={paused}
			aria-label="Solve3 ve(3,3) flywheel"
		>
			<header className={styles.header}>
				<div className={styles.headerRail}>
					<span>THE SOLVE3 FLYWHEEL</span>
					<button
						type="button"
						className={styles.motionControl}
						onClick={() => setPaused((value) => !value)}
					>
						{paused ? (
							<IconPlayerPlay size={15} aria-hidden />
						) : (
							<IconPlayerPause size={15} aria-hidden />
						)}
						{paused ? "Play animation" : "Pause animation"}
					</button>
				</div>
				<h3>Each participant gives the next a reason to join.</h3>
				<p>
					Select a step to follow how voting connects liquidity and rewards.
				</p>
			</header>
			<div className={styles.entry}>
				<b>Partner-funded incentives</b>
				<span>↓ Give voters a reason to back a pool</span>
			</div>
			<div className={styles.diagram}>
				<svg
					className={styles.arrows}
					viewBox="0 0 900 330"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					<defs>
						<marker
							id={id + "-arrow"}
							markerWidth="8"
							markerHeight="8"
							refX="6"
							refY="4"
							orient="auto"
						>
							<path d="M0 0 L8 4 L0 8" fill="#a49bff" />
						</marker>
					</defs>
					{tracks.map((track, index) => (
						<g key={track}>
							<path
								d={track}
								className={styles.track}
								markerEnd={`url(#${id}-arrow)`}
							/>
							<path
								d={track}
								pathLength="100"
								className={styles.pulse}
								style={delay(index)}
							/>
						</g>
					))}
				</svg>
				<ol className={styles.steps}>
					{steps.map((step, index) => {
						const Icon = icons[index];
						return (
							<li key={step.title} className={styles.step} style={delay(index)}>
								<button
									type="button"
									aria-pressed={selected === index}
									aria-controls={id + "-detail"}
									onClick={() => setSelected(index)}
								>
									<div className={styles.stepTop}>
										<Icon size={18} aria-hidden />
										<span className={styles.number}>
											{String(index + 1).padStart(2, "0")}
										</span>
									</div>
									<strong>{step.title}</strong>
									<small>{step.short}</small>
								</button>
							</li>
						);
					})}
				</ol>
				<div className={styles.center}>
					<div className={styles.hub} aria-hidden="true">
						<svg viewBox="0 0 100 100" className={styles.rotor}>
							<circle cx="50" cy="50" r="46" />
							<path d="M50 4 A46 46 0 0 1 96 50 M50 96 A46 46 0 0 1 4 50" />
							<circle cx="50" cy="50" r="35" />
						</svg>
						<b>ve(3,3)</b>
					</div>
					<span>Weekly epochs</span>
				</div>
			</div>
			<div className={styles.return}>
				↳ Voter rewards can encourage the next round of locking and voting
			</div>
			<div
				className={styles.detail}
				id={id + "-detail"}
				aria-live="polite"
				aria-atomic="true"
			>
				<small>
					{steps[selected].role} · Step {selected + 1}
				</small>
				<h4>{steps[selected].title}</h4>
				<p>{steps[selected].detail}</p>
			</div>
			<p className={styles.note}>
				Votes set allocations. Liquidity, trading activity and future
				participation depend on user choices. Rewards vary with actual fees and
				funded incentives.
			</p>
		</section>
	);
}
