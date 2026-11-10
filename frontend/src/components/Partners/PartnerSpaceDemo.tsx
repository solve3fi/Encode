"use client";

import Link from "next/link";
import { useState } from "react";
import classes from "./PartnerSpace.module.css";

/**
 * Demo partner space for recordings. Everything here is sample data for an invented partner ("Moon Cat") and the
 * buttons only change local state: no wallet is needed, no signature is requested and no transaction is sent.
 * The real page is PartnerSpace; this mirrors its layout so a walkthrough looks the same.
 */
const EPOCH = 5;
const ROWS = [
	{ epoch: 4, fees: "412.30 devUSDC · 1,200 MCAT", emissions: "8,420 SOLV3" },
	{ epoch: 3, fees: "268.75 devUSDC · 950 MCAT", emissions: "6,115 SOLV3" },
];
const WALLETS = [
	{ address: "7mCa…Demo", note: "This wallet (demo)" },
	{ address: "3fQz…Demo", note: "Registered" },
];

export const PartnerSpaceDemo: React.FC = () => {
	const [claimed, setClaimed] = useState(false);
	const [voted, setVoted] = useState(false);
	const [auto, setAuto] = useState(false);
	const [copied, setCopied] = useState(false);

	const path: Array<[string, string, string]> = [
		["Done", "Whitelisted", "Your token is on the Solve3 list."],
		["Done", "Seed a pool", "Live: MCAT/devUSDC · 0.30%."],
		["Done", "Gauge active", "Voters can steer rewards to your pool."],
		[voted || auto ? "Done" : "Next", "Lock and vote", "Put voting power behind your gauge each epoch."],
		["Later", "Day-30 readout", "Review growth and decide whether to scale."],
	];

	return (
		<div className={classes.page}>
			<div
				role="note"
				style={{
					border: "1px dashed rgba(245,177,76,0.6)",
					background: "rgba(245,177,76,0.08)",
					color: "#F5B14C",
					borderRadius: 12,
					padding: "10px 14px",
					fontSize: 13,
					fontWeight: 600,
				}}
			>
				DEMO DATA · A sample partner space for a walkthrough. Nothing here is real, no wallet is needed and no transaction is sent.
			</div>

			<header className={classes.top}>
				<div className={classes.head}>
					<span className={classes.eyebrow}>Partner space</span>
					<h1>Moon Cat</h1>
					<div className={classes.pills}>
						<span>MCAT</span>
						<span className={classes.badge}>Whitelisted</span>
						<span className={classes.badge}>Gauge active</span>
					</div>
				</div>
				<div className={classes.link}>
					<span className={classes.eyebrow}>Private partner link</span>
					<div>
						<code>dev.solve3.fi/partner/moon-cat</code>
						<button
							type="button"
							className={classes.ghost}
							onClick={() => {
								setCopied(true);
								window.setTimeout(() => setCopied(false), 1500);
							}}
						>
							{copied ? "Copied" : "Copy"}
						</button>
					</div>
				</div>
			</header>

			<section className={classes.panel} aria-label="Message from Solve3">
				<div>
					<h2>A note from Solve3</h2>
					<p>Welcome aboard. Your pool is live and your gauge is active. Lock some SOLV3 and put your votes behind MCAT/devUSDC this epoch to start the flywheel.</p>
				</div>
			</section>

			<div className={classes.tiles}>
				<div>
					<span>Gauge</span>
					<strong>Active</strong>
					<small>MCAT/devUSDC · 0.30% fee tier</small>
				</div>
				<div>
					<span>Vote share</span>
					<strong>{voted || auto ? "9.8%" : "6.4%"}</strong>
					<small>Of all votes in epoch {EPOCH}</small>
				</div>
				<div>
					<span>Accelerator</span>
					<strong>Enrolled</strong>
					<small>3 of 4 epochs left</small>
				</div>
				<div>
					<span>Claimable epochs</span>
					<strong>{claimed ? 0 : ROWS.length}</strong>
					<small>Voting rewards ready to claim · current epoch {EPOCH}</small>
				</div>
			</div>

			<div className={classes.columns}>
				<section className={classes.panel} aria-label="Claim rewards">
					<div className={classes.panelHead}>
						<div>
							<h2>Claim rewards</h2>
							<p>Rewards by epoch, collected with one wallet confirmation. Rewards for votes in epoch N are claimable from epoch N+1.</p>
						</div>
						<button type="button" className={classes.primary} disabled={claimed} onClick={() => setClaimed(true)}>
							{claimed ? "Claimed (demo)" : "Claim all"}
						</button>
					</div>
					<div className={classes.tableWrap}>
						<div role="table" aria-label="Rewards by epoch" className={classes.table}>
							<div role="row" className={`${classes.row} ${classes.rowHead}`}>
								<span role="columnheader">Epoch</span>
								<span role="columnheader">Fees + bribes</span>
								<span role="columnheader">SOLV3 emissions</span>
								<span role="columnheader">Status</span>
							</div>
							{ROWS.map((r) => (
								<div role="row" className={classes.row} key={r.epoch}>
									<span role="cell">Epoch {r.epoch}</span>
									<span role="cell">{r.fees}</span>
									<span role="cell">{r.emissions}</span>
									<span role="cell">
										<span className={classes.status}>{claimed ? "Claimed" : "Claimable"}</span>
									</span>
								</div>
							))}
						</div>
					</div>
					{claimed && <p className={classes.muted} role="status">Demo only: no transaction was sent.</p>}
				</section>

				<div className={classes.side}>
					<section className={classes.panel} aria-label="Partner wallets">
						<div>
							<h2>Your partner wallets</h2>
							<p>Only these wallets can open this space. To change them, contact Solve3.</p>
						</div>
						{WALLETS.map((w) => (
							<div className={classes.toggle} key={w.address}>
								<div>
									<strong style={{ fontFamily: "ui-monospace, monospace" }}>{w.address}</strong>
									<small>{w.note}</small>
								</div>
							</div>
						))}
					</section>

					<section className={classes.panel} aria-label="Auto-vote">
						<div className={classes.toggle}>
							<div>
								<h2>Auto-vote</h2>
								<small>Let the keeper put your lock behind your gauge every epoch, so a missed week never costs rewards.</small>
							</div>
							<button type="button" className={auto ? classes.primary : classes.ghost} aria-pressed={auto} onClick={() => setAuto((a) => !a)}>
								{auto ? "On" : "Off"}
							</button>
						</div>
					</section>

					<section className={classes.panel} aria-label="Voting power">
						<div>
							<h2>Voting power</h2>
							<p>12,480 veSOLV3 · locked until epoch 21</p>
						</div>
						<button type="button" className={classes.ghost} disabled={voted} onClick={() => setVoted(true)}>
							{voted ? "Voted for MCAT/devUSDC (demo)" : "Vote for MCAT/devUSDC"}
						</button>
					</section>
				</div>
			</div>

			<section className={classes.panel} aria-label="Launch path">
				<h2>Your launch path</h2>
				<div className={classes.path}>
					{path.map(([state, title, sub]) => (
						<div key={title}>
							<span className={state === "Done" ? classes.done : classes.next}>{state}</span>
							<strong>{title}</strong>
							<small>{sub}</small>
						</div>
					))}
				</div>
			</section>

			<footer className={classes.foot}>
				<a href="mailto:admin@solve3.fi">admin@solve3.fi</a>
				<Link href="/partners/onboarding">Onboarding</Link>
				<a href="https://discord.gg/ZDyXeyjGc7">Discord</a>
			</footer>
		</div>
	);
};
