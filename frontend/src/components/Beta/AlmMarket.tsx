"use client";

import { useEffect, useState } from "react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import home from "@/components/ProtocolHome/ProtocolHome.module.css";
import snapshot from "@/data/almMarket.json";
import css from "./Beta.module.css";
import pv from "./Preview.module.css";
import { StepFlow } from "./Flow";
import { PrivateProof } from "./PrivateProof";

// How a verdict is made (illustration of the research method, not live output).
const VERDICT_STEPS = [
	{ title: "Read the pool", text: "Fee tier, recent trading volume and how much other liquidity competes for those fees.", tag: "public pool data" },
	{ title: "Model a position", text: "A concentrated range around the current price, re-centred when price leaves it.", tag: "walk-forward" },
	{ title: "Fees against swings", text: "Fee income on one side. On the other, what price moving through the range costs, which grows with volatility.", tag: "context, not a driver" },
	{ title: "Compare with holding", text: "The net result versus simply holding the same SOL and USDC over the same hours.", tag: "same hours, same capital" },
	{ title: "Verdict, then keep score", text: "LP favored, Marginal or Hold favored. Every verdict is logged and scored against what happened next.", tag: "unproven until scored" },
] as const;

type Row = { name: string; note: string; fees: number; swing: number; action: number };
const netOf = (r: Row) => Math.round((r.fees - r.swing - r.action) * 100) / 100;
const money = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0 })}`;

// Hypothetical scenarios with invented numbers. Hold is the baseline (net 0 by definition).
const SCENARIOS = [
	{
		id: "calm",
		label: "Calm, range-bound",
		title: "Calm market",
		rows: [
			{ name: "Hold", note: "baseline", fees: 0, swing: 0, action: 0 },
			{ name: "Standard LP", note: "fixed range", fees: 900, swing: 660, action: 0 },
			{ name: "ALM", note: "re-centres its range", fees: 1010, swing: 595, action: 5 },
		],
		points: ["Price stays in a band, so fees are earned steadily.", "Both LP styles beat holding. ALM edges ahead by keeping its range centred on the price."],
	},
	{
		id: "choppy",
		label: "Choppy, high swings",
		title: "Choppy market",
		rows: [
			{ name: "Hold", note: "baseline", fees: 0, swing: 0, action: 0 },
			{ name: "Standard LP", note: "fixed range", fees: 1150, swing: 1470, action: 0 },
			{ name: "ALM", note: "sits out when swings beat fees", fees: 0, swing: 0, action: 0.5 },
		],
		points: ["Price swings cost more than the fees bring in, so a standard LP ends behind holding.", "ALM's verdict is Hold, so it stays out and pays only a tiny action cost. Knowing when not to provide liquidity is the point."],
	},
	{
		id: "trend",
		label: "Strong trend",
		title: "Strongly trending market",
		rows: [
			{ name: "Hold", note: "baseline", fees: 0, swing: 0, action: 0 },
			{ name: "Standard LP", note: "fixed range", fees: 700, swing: 1590, action: 0 },
			{ name: "ALM", note: "exits as the trend builds", fees: 380, swing: 640, action: 1.5 },
		],
		points: ["A one-way move is the hardest case for any LP.", "ALM limits the damage by exiting earlier than a fixed range would, but it still ends behind holding. We show this case on purpose."],
	},
] as const;

type Ctx = {
	fearGreed: { available: boolean; value?: number; classification?: string; previous?: number; error?: string };
	sol: { available: boolean; markPrice?: number; fundingPerHour?: number; fundingAnnualizedPct?: number; openInterestUsd?: number; error?: string };
	market?: { available: boolean; lookbackHours: number; sigmaAnnualized?: number; driftPctPerHour?: number; bars?: number; error?: string };
};

const usd = (n: number | null | undefined, d = 0) =>
	n == null ? "n/a" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: d });

export const AlmMarket = () => {
	const [ctx, setCtx] = useState<Ctx | null>(null);
	const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]["id"]>("calm");
	const active = SCENARIOS.find((x) => x.id === scenario) ?? SCENARIOS[0];
	useEffect(() => {
		let live = true;
		fetch("/api/beta/alm-context")
			.then((r) => r.json())
			.then((c: Ctx) => live && setCtx(c))
			.catch(() => live && setCtx({ fearGreed: { available: false, error: "unavailable" }, sol: { available: false, error: "unavailable" } }));
		return () => {
			live = false;
		};
	}, []);

	const pools = snapshot.pools;
	const count = (v: string) => pools.filter((p) => p.verdict === v).length;
	const lp = count("lp-favored");
	const marg = count("marginal");
	const hold = count("hold-favored");
	const lead = hold > lp + marg ? "hold" : lp > hold + marg ? "lp" : "mixed";
	const asOf = new Date(snapshot.asOf).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
	// Live 72h drift + volatility from the context API (same formula as the ALM engine); the research snapshot is the
	// labelled fallback when the live source is unavailable.
	const liveMarket = ctx?.market?.available ? ctx.market : null;
	const drift = liveMarket?.driftPctPerHour ?? snapshot.driftPctPerHour;
	const sigma = liveMarket?.sigmaAnnualized ?? snapshot.sigmaAnnualized;
	const momentum = Math.abs(drift) < 0.01 ? "Flat" : drift > 0 ? "Rising" : "Falling";
	const fwd = snapshot.forward;
	const liveSince = fwd.liveSince ? new Date(`${fwd.liveSince}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" }) : null;

	return (
		<div className={home.page}>
			<div className={home.aurora} aria-hidden="true">
				<i />
				<i />
				<b />
			</div>
			<Header variant="marketing" />

			<main className={home.main}>
				<section className={home.hero}>
					<div className={home.heroCopy}>
						<p className={home.eyebrow}>
							ALM · Beta
						</p>
						<span className={css.soon}>Preview</span>
						<h1>
							Know when <span className={home.grad}>not</span>
							<br />
							to provide liquidity.
						</h1>
						<p className={home.lede}>
							Most liquidity tools show you a big APR. ALM shows you the whole sum: the fees a position could earn, what price swings would cost, and whether
							simply holding would have done better. It tells you plainly, pool by pool, and keeps score on itself.
						</p>
						<div className={pv.hero3}>
							<div className={pv.stat}>
								<b>{snapshot.pools.length} pools</b>
								<span>SOL/USDC pools modelled for a ${snapshot.capitalUSD.toLocaleString("en-US")} position over {snapshot.horizonHours} hours</span>
							</div>
							<div className={pv.stat}>
								<b>Fees vs swings</b>
								<span>every verdict nets fee income against the modelled cost of price moves and compares with holding</span>
							</div>
							<div className={pv.stat}>
								<b>Scored, not claimed</b>
								<span>every verdict goes into a forward log and is checked against what happened next</span>
							</div>
						</div>
						<div className={css.notice}>
							<strong>Research only.</strong> This is a preview of a feature that is not live. It is not financial advice, it does not trade or move funds,
							and every verdict is an <strong>unproven</strong> hypothesis. Nothing here is a recommendation to buy, sell or provide liquidity.
						</div>
					</div>
				</section>

				<section aria-label="Strategy view" className={home.section}>
					<h2>Strategy view</h2>
					<p className={home.sectionLede}>
						This is the call ALM would make today, and the point of the tool: it is willing to say &quot;sit this one out&quot;. What the model says for a ${snapshot.capitalUSD.toLocaleString("en-US")} position over {snapshot.horizonHours} hours, across {pools.length} SOL/USDC pools.
						Model re-run {asOf} UTC on market data captured {snapshot.inputsAsOf}.
					</p>
					<div className={css.strategy}>
						<div className={`${css.pick} ${lead === "lp" ? css.pickOn : css.pickOff}`}>
							<span className={lead === "lp" ? css.tagOn : css.tagOff}>{lead === "lp" ? "Model view" : "Not favored"}</span>
							<h3>Provide liquidity (LP)</h3>
							<b>{lp} of {pools.length}</b>
							<p>pools where fees beat the cost of price swings. {marg ? `${marg} marginal.` : ""}</p>
						</div>
						<div className={`${css.pick} ${lead === "hold" ? css.pickOn : css.pickOff}`}>
							<span className={lead === "hold" ? css.tagOn : css.tagOff}>{lead === "hold" ? "Model view" : "Not favored"}</span>
							<h3>Hold SOL</h3>
							<b>{hold} of {pools.length}</b>
							<p>pools where simply holding looked better than providing liquidity.</p>
						</div>
						<div className={`${css.pick} ${css.pickOff}`}>
							<span className={css.tagOff}>Not offered</span>
							<h3>Buy</h3>
							<b>No signal</b>
							<p>
								ALM does not forecast price direction. Sentiment inputs were tested against held-out data and added no measurable edge, so they are shown as
								context only and never produce a buy call.
							</p>
						</div>
					</div>
				</section>

				<section aria-label="What you get" className={home.section}>
					<h2>What ALM is for</h2>
					<p className={home.sectionLede}>A second opinion before you put money into a pool. Planned for the full release.</p>
					<div className={pv.pro}>
						<div className={pv.proc}>
							<span className={pv.plan}>PLANNED</span>
							<h3>An honest verdict per pool</h3>
							<p>LP favored, Marginal or Hold favored, with the arithmetic behind it, so a high headline APR never hides the cost of price swings.</p>
						</div>
						<div className={pv.proc}>
							<span className={pv.plan}>PLANNED</span>
							<h3>Side-by-side pool comparison</h3>
							<p>Depth, fee APR and emissions across venues in one table, from public data, so you can see where a pool really stands.</p>
						</div>
						<div className={pv.proc}>
							<span className={pv.plan}>PLANNED</span>
							<h3>A public track record</h3>
							<p>Every verdict is logged forward and scored. The hit rate means something only once enough live verdicts are scored, and we show that count.</p>
						</div>
					</div>
				</section>

				<section aria-label="How a verdict is made" className={home.section}>
					<h2>How a verdict is made</h2>
					<p className={home.sectionLede}>The research method behind the strategy view, step by step.</p>
					<StepFlow steps={VERDICT_STEPS} label="Five steps from pool data to a scored verdict" />
				</section>

				<section aria-label="Worked example" className={home.section}>
					<h2>How ALM compares in three markets</h2>
					<span className={css.soon}>Hypothetical · invented numbers</span>
					<p className={home.sectionLede}>
						One ${snapshot.capitalUSD.toLocaleString("en-US")} position for {snapshot.horizonHours} hours, run three ways: just hold, a standard fixed-range LP, and ALM,
						which re-centres its range and sits out when the model says fees will not cover price swings. These scenarios are made up to show how the method behaves.
						They are not a backtest, not a track record and not a promise.
					</p>
					<div className={css.scen} role="group" aria-label="Market scenario">
						{SCENARIOS.map((sc) => (
							<button key={sc.id} type="button" aria-pressed={scenario === sc.id} onClick={() => setScenario(sc.id)} className={css.scenBtn}>
								{sc.label}
							</button>
						))}
					</div>
					<div className={css.twoCol}>
						<div className={css.tableWrap}>
							<table className={css.table} aria-label={`Hypothetical result in a ${active.label.toLowerCase()} market`}>
								<thead>
									<tr>
										<th>Strategy</th>
										<th>Fee income</th>
										<th>Swing cost</th>
										<th>Action cost</th>
										<th>Net vs holding</th>
									</tr>
								</thead>
								<tbody>
									{active.rows.map((r) => (
										<tr key={r.name} className={r.name === "ALM" ? css.rowAlm : undefined}>
											<td>
												<strong>{r.name}</strong>
												<br />
												<small>{r.note}</small>
											</td>
											<td className={`${css.num} ${r.fees > 0 ? css.pos : ""}`}>{r.fees ? `+$${r.fees.toLocaleString("en-US")}` : "$0"}</td>
											<td className={`${css.num} ${r.swing ? css.neg : ""}`}>{r.swing ? `-$${r.swing.toLocaleString("en-US")}` : "$0"}</td>
											<td className={`${css.num} ${r.action ? css.neg : ""}`}>{r.action ? `-$${r.action.toFixed(2)}` : "$0"}</td>
											<td className={`${css.num} ${netOf(r) > 0 ? css.pos : netOf(r) < 0 ? css.neg : ""}`}>
												<strong>{money(netOf(r))}</strong>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className={css.honest}>
							<h3>{active.title}</h3>
							<ul>
								{active.points.map((t) => (
									<li key={t}>{t}</li>
								))}
								<li>
									Within ${100} either way of holding counts as <strong>Marginal</strong>. The same arithmetic is re-run as pool depth, volume and volatility change,
									so a verdict can flip.
								</li>
								<li>In a real market ALM can also lose to holding. The track record section below is the honest view of how far the model has been tested.</li>
							</ul>
						</div>
					</div>
				</section>

				<section aria-label="Market sentiment" className={home.section}>
					<h2>Market sentiment</h2>
					<p className={home.sectionLede}>Context, not a driver. These do not change any verdict above.</p>
					<div className={css.ctx}>
						<div className={`${css.ctxCell} ${ctx?.fearGreed.available ? "" : css.unavailable}`}>
							<span className={home.eyebrow}>Fear &amp; Greed</span>
							<strong>{ctx ? (ctx.fearGreed.available ? ctx.fearGreed.value : "Unavailable") : "Loading…"}</strong>
							<p>
								{ctx?.fearGreed.available
									? `${ctx.fearGreed.classification}${ctx.fearGreed.previous != null ? ` · yesterday ${ctx.fearGreed.previous}` : ""}`
									: "Live reading not available right now."}
							</p>
							<small>Crypto-wide index, refreshed every few minutes</small>
						</div>
						<div className={`${css.ctxCell} ${ctx?.sol.available ? "" : css.unavailable}`}>
							<span className={home.eyebrow}>SOL perp funding</span>
							<strong>{ctx ? (ctx.sol.available ? usd(ctx.sol.markPrice, 2) : "Unavailable") : "Loading…"}</strong>
							<p>
								{ctx?.sol.available
									? `Funding ${((ctx.sol.fundingPerHour ?? 0) * 100).toFixed(4)}%/h (${(ctx.sol.fundingAnnualizedPct ?? 0).toFixed(1)}% a year)${
											ctx.sol.openInterestUsd ? ` · open interest ${usd(ctx.sol.openInterestUsd / 1e6, 1)}M` : ""
										}`
									: "Live reading not available right now."}
							</p>
							<small>Hyperliquid SOL perpetual, read-only</small>
						</div>
						<div className={css.ctxCell}>
							<span className={home.eyebrow}>Momentum &amp; volatility</span>
							<strong>{momentum}</strong>
							<p>
								Price drift {drift >= 0 ? "+" : ""}
								{drift.toFixed(4)}% per hour · realised volatility about {(sigma * 100).toFixed(0)}% a year.
							</p>
							<small>
								{liveMarket
									? `Live: last ${liveMarket.lookbackHours} hours of Coinbase SOL-USD hourly candles`
									: ctx
										? "Live source unavailable: showing the research snapshot"
										: "Loading…"}
							</small>
						</div>
					</div>
				</section>

				<section aria-label="Example comparison" className={home.section}>
					<h2>Example comparison</h2>
					<span className={css.soon}>Example only</span>
					<p className={home.sectionLede}>
						A teaser of the pool comparison that comes with the full release. These are point-in-time public figures from {snapshot.sample.asOf}, shown to
						illustrate the layout. They are not a ranking, a verdict or a recommendation.
					</p>
					<div className={css.tableWrap}>
						<table className={css.table}>
							<thead>
								<tr>
									<th>Venue</th>
									<th>Pool</th>
									<th>Liquidity (TVL)</th>
									<th>Fee APR</th>
									<th>Emissions</th>
								</tr>
							</thead>
							<tbody>
								{snapshot.sample.rows.map((r) => (
									<tr key={r.venue}>
										<td>{r.venue}</td>
										<td>{r.pool}</td>
										<td className={css.num}>{r.tvlUSD == null ? "n/a" : usd(r.tvlUSD)}</td>
										<td className={css.num}>{r.feeApr}</td>
										<td>{r.emissions}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className={css.fine}>
						Example data, not live. Fee APR is estimated from recent trading volume and pool fee tiers, and reward emissions are shown only where they could be read.
						{" "}{snapshot.sample.note} Pools differ a lot in depth, so a headline APR on a small pool says little about what a position would actually earn.
					</p>
				</section>

				<div className={home.section}>
					<PrivateProof
						product="ALM"
						who="ALM is a working keeper and research toolkit that the Solve3 team uses today. It is not open to the public and it manages no one's money: the trial runs on paper inventory, and nothing is funded until a strategy clears a pre-set bar."
						built={[
							"A keeper with commands to baseline, inspect, plan, simulate, run on devnet, harvest, exit, clean up and stop or reconcile (done 20 Oct 2026).",
							"Exact integer range and liquidity planning that uses the canonical Solve3 SDK math, with persistent transaction records.",
							"The research engine behind this page: pool verdicts, a forward log, an emissions comparison and a walk-forward test of sentiment inputs.",
							"A private repository: 207 commits since 17 Oct 2026.",
							"A price reference writer for the devnet pilot: the median of three public SOL/USD spot prices, written only when at least two agree (8 Nov 2026).",
						]}
						running={[
							"A private trial app where the real planner runs on paper inventory: load a scenario, preview the keeper's decision, apply it, move the market, rebalance and exit. No wallet or funds.",
							"A private dashboard that reads real, read-only observations and keeps an indexed history of positions and value.",
							"Research outputs behind the numbers on this page, re-run on 8 Nov 2026 after a fee-rate correction.",
							"A daily forward log that records one live verdict per day, so the track record builds from real, unseen data (since 8 Nov 2026).",
						]}
						tested={[
							"The full pilot flow was run end to end on offline and local setups only: simulated actions, finalized receipts, a restart with recovery, and an owner exit (2 Nov 2026).",
							"One of those tests opens, exits and cleans up a position against the real program on a local VM: the principal came back to the owner's accounts and the position was closed.",
							"Held-out and walk-forward evaluations are published in the research folder, including the ones that disagreed with the optimistic replay.",
						]}
						shots={[
							{ src: "/assets/beta/alm-trial.png", alt: "The private ALM trial with paper inventory and a keeper decision", caption: "The private trial app: the real planner previewing a rebalance on paper inventory, with a receipt for every step. All balances here are synthetic." },
						]}
						notYet={[
							"No funded run yet. The research found no settings that clear the proposed acceptance bar, so no strategy is approved for real funds. That gate is deliberate.",
							"A funded devnet pilot is the next step. Its dedicated wallet, limits and config are prepared and waiting for funding approval; nothing has signed on devnet or mainnet.",
							"The trial uses synthetic inventory, so its screens show how decisions work, not returns.",
						]}
						checked="Facts checked on 8 Nov 2026 against the private repository, its task log and research files. The screenshot is from the private trial app."
					/>
				</div>

				<section aria-label="How much to trust this" className={home.section}>
					<div className={css.honest}>
						<h3>How much to trust this</h3>
						<ul>
							<li>
								<strong>Unproven.</strong> Live-scored verdicts so far: {fwd.liveScored} (at least {fwd.minScored} are needed before a hit rate means
								anything).{" "}
								{liveSince
									? `Live logging started ${liveSince}: one verdict a day, each scored three days later against what actually happened.`
									: null}
							</li>
							<li>
								Replayed on past data, the model&apos;s verdicts hit {(fwd.backfillHitRate * 100).toFixed(0)}% of {fwd.backfillScored} windows. That is not skill:
								holding beat providing liquidity in {(fwd.backfillAlwaysHoldRate * 100).toFixed(0)}% of those same windows, so a rule that always says
								&quot;hold&quot; scores as well or better. The stricter walk-forward test agrees: {snapshot.walkForward.lpFavoredFolds} of {snapshot.walkForward.folds} folds
								favored LP.
							</li>
							<li>
								<strong>Correction, {snapshot.erratum.date}.</strong> {snapshot.erratum.text}
							</li>
							<li>Sentiment, funding and momentum were tested and did not improve results after costs, which is why they are context only.</li>
							<li>Past data, model assumptions and a single point in time. Real results will differ.</li>
						</ul>
						<p className={css.fine}>
							Source: {snapshot.source}. Snapshot generated {asOf} UTC from market data captured {snapshot.inputsAsOf}. Live context above refreshes on load. Not
							investment advice.
						</p>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
};
