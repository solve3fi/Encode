"use client";

import { useState } from "react";
import classes from "./Partners.module.css";

const MODEL = [
	["Add rewards", "Your project puts incentives behind a pool."],
	["Get votes", "veSOLV3 holders choose which pools receive SOLV3 rewards."],
	["Attract LPs", "More rewards make your pool more attractive to liquidity providers."],
	["Grow + measure", "Track liquidity, volume, fees and incentive efficiency."],
] as const;

const WHY = [
	["GROW", "Add another source of rewards around your liquidity market."],
	["CONTROL", "Choose whether to incentivize and how much to commit."],
	["COMPOUND", "Partner rewards attract votes; votes direct more SOLV3 emissions to your pool."],
] as const;

const PILOT = [
	["Week 0", "Pick a pool", "Choose the asset pair and set a liquidity target."],
	["Week 0", "Add rewards", "Set the partner incentive budget. We launch the gauge."],
	["Weeks 1–4", "Let users vote", "SOLV3 emissions follow vote weight every epoch."],
	["Day 30", "Measure growth", "Review liquidity, volume, fees and efficiency together."],
] as const;

const FAQ = [
	["Who decides where emissions go?", "veSOLV3 holders, every weekly epoch. Your rewards give them a reason to vote for your pool."],
	["When do epochs run?", "Thursday 00:00 UTC to Thursday 00:00 UTC. Voting closes five minutes before each boundary."],
	["Do we have to invest or buy SOLV3?", "No. Partnership comes first. Strategic financing is a separate conversation."],
	["Is Solve3 live?", "Solve3 is live for launch partners. Set up a pilot today and we will walk you through the pool and gauge."],
] as const;

const WEEKS = [
	["$48K", 26],
	["$91K", 50],
	["$138K", 76],
	["$182K", 100],
] as const;

type Status = "idle" | "sending" | "sent" | "error";

export const PartnersPage: React.FC = () => {
	const [status, setStatus] = useState<Status>("idle");
	const [message, setMessage] = useState("");

	const submit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		setStatus("sending");
		try {
			const res = await fetch("/api/partner-applications", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(Object.fromEntries(form.entries())),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "Something went wrong");
			setStatus("sent");
			setMessage("Request received. We will reach out to schedule your pilot.");
		} catch (error) {
			setStatus("error");
			setMessage(error instanceof Error ? error.message : "Something went wrong");
		}
	};

	return (
		<div className={classes.page}>
			<section className={classes.hero}>
				<div className={classes.heroCopy}>
					<span className={classes.eyebrow}>Solve3 / Launch partners</span>
					<h1>
						Turn rewards into <span className={classes.grad}>deeper liquidity.</span>
					</h1>
					<p className={classes.lede}>
						Give LPs a better reason to choose your market. Put incentives behind your pool, attract votes, and let SOLV3 emissions follow.
					</p>
					<div className={classes.actions}>
						<a href="#apply" className={classes.primary}>Start a 30-day pilot</a>
						<a href="#model" className={classes.ghost}>How it works</a>
					</div>
					<p className={classes.small}>No investment required. Strategic financing is a separate conversation.</p>
					<p className={classes.small}><strong>Accelerator:</strong> selected partners can qualify for vote matching. <a href="#accelerator">See how →</a></p>
				</div>

				<figure className={classes.readout}>
					<figcaption>
						<span>30-day pilot readout · ACME / SOL</span>
						<span className={classes.badge}>Example data</span>
					</figcaption>
					<div className={classes.metrics}>
						<div><span>Pool liquidity</span><strong>$182K</strong><small>+$134K since week 1</small></div>
						<div><span>Weekly volume</span><strong>$640K</strong><small>+212% vs week 1</small></div>
						<div><span>Fees generated</span><strong>$1,920</strong><small>0.3% fee tier, week 4</small></div>
						<div><span>Incentive efficiency</span><strong>$5.40</strong><small>liquidity added per $1 of rewards</small></div>
					</div>
					<div className={classes.chart}>
						<span>Pool liquidity by week</span>
						<div className={classes.bars}>
							{WEEKS.map(([label, height]) => (
								<div key={label}>
									<span>{label}</span>
									<div style={{ height: `${height}%` }} />
								</div>
							))}
						</div>
						<div className={classes.weeks}>
							<span>Week 1</span><span>Week 2</span><span>Week 3</span><span>Week 4</span>
						</div>
					</div>
					<small className={classes.small}>Example numbers for a $25K reward budget. Your readout uses your own pool&apos;s data.</small>
				</figure>
			</section>

			<section id="model" className={classes.section}>
				<span className={classes.eyebrow}>01 / The model</span>
				<h2>Projects add rewards. Users vote. Liquidity follows.</h2>
				<p className={classes.lede}>You control your incentive budget. The market decides where SOLV3 emissions go.</p>
				<ol className={classes.four}>
					{MODEL.map(([title, text], index) => (
						<li key={title} className={classes.tile}>
							<span className={classes.num}>{index + 1}</span>
							<h3>{title}</h3>
							<p>{text}</p>
						</li>
					))}
				</ol>
			</section>

			<section id="accelerator" className={classes.section}>
				<span className={classes.eyebrow}>02 / The Accelerator Program</span>
				<h2>We back your pool with votes while it finds its feet.</h2>
				<p className={classes.lede}>
					New pools struggle to attract votes before they have volume, and votes are what bring emissions. Selected projects can apply for Accelerator matching: Solve3&apos;s own veSOLV3 adds votes to
					your gauge, so your incentives and your community&apos;s votes start from a stronger place.
				</p>
				<div className={classes.three}>
					<div className={classes.tile}>
						<span className={classes.eyebrow}>Qualify</span>
						<h3>2% of all votes.</h3>
						<p>A pool that has earned 2% of all Solve3 votes qualifies for matching. Your community&apos;s votes and your bribes get you there; the Accelerator builds on them.</p>
					</div>
					<div className={classes.tile}>
						<span className={classes.eyebrow}>Matched</span>
						<h3>Up to a 10% match.</h3>
						<p>Matching is capped at 10%, so it reinforces real demand for your pool instead of replacing it.</p>
					</div>
					<div className={classes.tile}>
						<span className={classes.eyebrow}>Time-boxed</span>
						<h3>For up to 4 epochs.</h3>
						<p>Matching runs for a maximum of four weekly epochs, long enough to build momentum and short enough to prove the pool stands on its own.</p>
					</div>
				</div>
				<ol className={classes.four}>
					<li className={classes.tile}><span className={classes.num}>1</span><h3>Apply</h3><p>Tick &quot;Apply for Accelerator matching&quot; in partner setup. Solve3 selects the projects.</p></li>
					<li className={classes.tile}><span className={classes.num}>2</span><h3>Add liquidity</h3><p>Seed your pool and add rewards so voters have a reason to back you.</p></li>
					<li className={classes.tile}><span className={classes.num}>3</span><h3>Matching runs itself</h3><p>Each epoch the keeper enrolls, matches and expires partners automatically. No manual requests.</p></li>
					<li className={classes.tile}><span className={classes.num}>4</span><h3>Be seen</h3><p>Accelerator pools carry a rocket badge in the pool lists, and your partner space shows how many epochs are left.</p></li>
				</ol>
				<div className={classes.actions}>
					<a href="/partners/onboarding" className={classes.primary}>Apply for Accelerator matching</a>
					<a href="#apply" className={classes.ghost}>Start a 30-day pilot</a>
				</div>
				<small className={classes.small}>Selection is by Solve3 and terms can change before the governance launch. Matching adds votes, not guaranteed rewards or returns.</small>
			</section>

			<section className={classes.section}>
				<span className={classes.eyebrow}>03 / Why partner</span>
				<h2>A better reason for LPs to choose your market.</h2>
				<p className={classes.lede}>
					You don&apos;t need to replace your existing liquidity strategy. Solve3 is another market where incentives compete for liquidity — and where your rewards can pull in more.
				</p>
				<div className={classes.three}>
					{WHY.map(([label, text]) => (
						<div key={label} className={classes.tile}>
							<span className={classes.eyebrow}>{label}</span>
							<p>{text}</p>
						</div>
					))}
				</div>
			</section>

			<section id="tools" className={classes.section}>
				<span className={classes.eyebrow}>04 / Your partner tools</span>
				<h2>Everything you need to run the campaign.</h2>
				<p className={classes.lede}>Approved partners get a private space, can keep their own locks voting for their pool, and can see how the campaign is doing.</p>
				<div className={classes.three}>
					<div className={classes.tile}>
						<span className={classes.eyebrow}>Partner space</span>
						<h3>A private page for your team.</h3>
						<p>Each approved partner gets a private link that opens only for up to three wallets you register. Sign one free message to enter. You see your pool and gauge status, your share of the vote, your launch path and any note from Solve3.</p>
					</div>
					<div className={classes.tile}>
						<span className={classes.eyebrow}>Auto-vote</span>
					<h3>Keep your own locks voting for you.</h3>
						<p>Enroll your locks and a keeper votes them for your gauge every epoch, so your own voting power never sits idle. Adding SOLV3 to a lock keeps its enrollment. A free partner voter removes the Auto-Vote fee once it is live; until then the standard 15% Auto-Vote fee applies.</p>
					</div>
					<div className={classes.tile}>
						<span className={classes.eyebrow}>Rewards and matching</span>
						<h3>Claim in one step, see what is matched.</h3>
						<p>Voting rewards by epoch are collected with a single wallet confirmation. Qualifying pools can be enrolled in the vote accelerator, which matches votes for a set number of epochs. Your space shows your status.</p>
					</div>
				</div>
				<small className={classes.small}>Partner tools are available once Solve3 approves your listing. Terms such as fees and matching can change before the governance launch.</small>
			</section>

			<section className={classes.section}>
				<span className={classes.eyebrow}>05 / The pilot</span>
				<h2>Start small. Prove it in 30 days.</h2>
				<p className={classes.lede}>One market. One incentive campaign. One clear review. Both teams get real data before committing more capital.</p>
				<div className={classes.four}>
					{PILOT.map(([when, title, text]) => (
						<div key={title} className={classes.tile}>
							<span className={classes.eyebrow}>{when}</span>
							<h3>{title}</h3>
							<p>{text}</p>
						</div>
					))}
				</div>
				<div className={classes.three}>
					<div className={classes.outcome}><span className={classes.eyebrow}>If it works</span><strong>Scale the campaign.</strong></div>
					<div className={classes.outcome}><span className={classes.eyebrow}>If it doesn&apos;t</span><strong>You learned before overspending.</strong></div>
					<div className={classes.outcome}><span className={classes.eyebrow}>Either way</span><strong>No investment required.</strong></div>
				</div>
			</section>

			<section className={classes.section}>
				<h2>Questions partners ask</h2>
				<div className={classes.faq}>
					{FAQ.map(([q, a]) => (
						<div key={q} className={classes.tile}>
							<h3>{q}</h3>
							<p>{a}</p>
						</div>
					))}
				</div>
			</section>

			<section id="apply" className={classes.apply}>
				<div className={classes.applyCopy}>
					<h2>Put your token&apos;s liquidity to work.</h2>
					<p className={classes.lede}>We&apos;ll help choose the market, launch the gauge and measure what happens.</p>
					<p className={classes.small}>
						Prefer email? <a href="mailto:admin@solve3.fi">admin@solve3.fi</a>
					</p>
				</div>
				<form className={classes.form} onSubmit={submit}>
					<div className={classes.row}>
						<label htmlFor="p-name">Project<input id="p-name" name="project" type="text" placeholder="Project name" required /></label>
						<label htmlFor="p-pair">Pool you want to grow<input id="p-pair" name="pair" type="text" placeholder="e.g. TOKEN / SOL" /></label>
					</div>
					<label htmlFor="p-mint">Token mint address<input id="p-mint" name="mint" type="text" placeholder="Mint address" /></label>
					<label htmlFor="p-contact">Contact (Telegram, X or email)<input id="p-contact" name="contact" type="text" placeholder="@handle or email" required /></label>
					<button type="submit" className={classes.primary} disabled={status === "sending" || status === "sent"}>
						{status === "sending" ? "Sending…" : status === "sent" ? "Request sent" : "Request a pilot"}
					</button>
					{message && (
						<p role="status" className={status === "error" ? classes.err : classes.ok}>{message}</p>
					)}
				</form>
			</section>
		</div>
	);
};
