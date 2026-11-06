"use client";

import { useMemo, useState } from "react";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import home from "@/components/ProtocolHome/ProtocolHome.module.css";
import css from "./Beta.module.css";
import p from "./Preview.module.css";
import { YieldFlow } from "./Flow";
import { PrivateProof } from "./PrivateProof";

const EXPLORER = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
import { FundNudge } from "@/components/Fund/FundNudge";

/**
 * Yield Hunter product preview for demos. REAL facts (from the Yield-Hunter repo plan and devnet deployment): deposit USDC,
 * receive solUSDC, a share token whose value rises as yield is earned; Claim profit redeems only the gain; an approved
 * protocol list with caps; a liquidity buffer; a timelock; a guardian that can pause. EVERY number below (rates, balances,
 * the chart, the activity feed) is SAMPLE DATA for the demo and is labelled as such on screen.
 */

// SAMPLE rates, not market data.
const STRATEGIES = [
	{ name: "Jupiter Lend", tier: "A", apy: 5.6, share: 34, cap: 40, color: "#685df7" },
	{ name: "Kamino Lend", tier: "A", apy: 5.1, share: 28, cap: 40, color: "#58d7ff" },
	{ name: "MarginFi", tier: "A", apy: 4.7, share: 18, cap: 35, color: "#f5b14c" },
	{ name: "Save", tier: "B", apy: 4.2, share: 8, cap: 20, color: "#5fe3a1" },
	{ name: "Drift spot", tier: "B", apy: 4.0, share: 4, cap: 15, color: "#ff8fb1" },
	{ name: "Idle buffer", tier: "", apy: 0, share: 8, cap: 100, color: "#454365" },
] as const;
const BLENDED = STRATEGIES.reduce((s, x) => s + (x.apy * x.share) / 100, 0);
const RATE = 1.0231; // sample solUSDC value in USDC

const FEED = [
	["12:00", "Read", "Compared 5 approved markets (read-only)", "ok"],
	["12:00", "Rank", "Net yield after the cost of moving: Jupiter Lend ahead by 0.5%", "ok"],
	["12:01", "Guard", "Move pays back its cost in 3.1 days (limit 7), cooldown clear", "ok"],
	["12:01", "Move", "Reallocated 2,500 USDC from Save to Jupiter Lend", "ok"],
	["12:02", "Report", "Vault value reported, share price 1.0231", "ok"],
	["18:00", "Read", "Utilization normal in all markets, buffer above minimum", "ok"],
	["18:00", "Hold", "No move: gain would not clear the cost of moving", "hold"],
] as const;

// Sample share-price history, rising slowly.
const SERIES = Array.from({ length: 30 }, (_, i) => 1 + (i / 29) * 0.0231 + Math.sin(i / 2.3) * 0.0006);

const money = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const Chart = () => {
	const w = 600;
	const h = 150;
	const min = Math.min(...SERIES);
	const max = Math.max(...SERIES);
	const pts = SERIES.map((v, i) => `${(i / (SERIES.length - 1)) * w},${h - 14 - ((v - min) / (max - min)) * (h - 34)}`);
	return (
		<svg className={p.chart} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Sample share price rising slowly over 30 days">
			<defs>
				<linearGradient id="yhg" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#685df7" stopOpacity=".45" />
					<stop offset="1" stopColor="#685df7" stopOpacity="0" />
				</linearGradient>
			</defs>
			<polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill="url(#yhg)" />
			<polyline points={pts.join(" ")} fill="none" stroke="#8c84ff" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
		</svg>
	);
};

type Tab = "earn" | "strategies" | "activity";

export const YieldHunterSoon = () => {
	const [tab, setTab] = useState<Tab>("earn");
	const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
	const [amount, setAmount] = useState("1000");
	const amt = Math.max(0, Number(amount.replace(/[^0-9.]/g, "")) || 0);
	const shares = useMemo(() => amt / RATE, [amt]);
	const yearly = amt * (BLENDED / 100);

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
							Yield Hunter · Product preview
						</p>
						<span className={css.soon}>Preview</span>
						<h1>
							Idle USDC,
							<br />
							<span className={home.grad}>working for you.</span>
						</h1>
						<p className={home.lede}>
							Deposit USDC, receive solUSDC, and let a rules-bound keeper spread the vault across Solana&apos;s main lending markets. solUSDC is a share token: its
							value rises as the vault earns, so holding compounds and you can claim just the profit whenever you like.
						</p>
						<div className={p.hero3}>
							<div className={p.stat}>
								<b>5</b>
								<span>approved lending markets, each with its own cap</span>
							</div>
							<div className={p.stat}>
								<b>Non-custodial</b>
								<span>you sign every deposit and withdrawal from your own wallet</span>
							</div>
							<div className={p.stat}>
								<b>Built on devnet</b>
								<span>full deposit, withdraw and claim flow tested end to end</span>
							</div>
						</div>
					</div>
				</section>

				<section aria-label="Product preview" className={`${home.section} ${p.wrap}`}>
					<div className={p.ribbon} role="note">
						<b>DEMO PREVIEW</b>
						<span>
							Rates, balances, the chart and the activity feed below are sample data to show how the product will look. Not live, not a quote, and returns are never
							guaranteed. Not open for deposits.
						</span>
					</div>

					<div className={p.app}>
						<div className={p.bar}>
							<div className={p.dots} aria-hidden="true">
								<i />
								<i />
								<i />
							</div>
							<div className={p.tabs} role="tablist" aria-label="Yield Hunter sections">
								{(
									[
										["earn", "Earn"],
										["strategies", "Strategies"],
										["activity", "Activity"],
									] as const
								).map(([k, l]) => (
									<button key={k} type="button" role="tab" aria-selected={tab === k} className={p.tab} onClick={() => setTab(k)}>
										{l}
									</button>
								))}
							</div>
							<span className={p.net}>Sample data</span>
						</div>

						{tab === "earn" && (
							<div className={p.body}>
								<div className={p.card}>
									<h3>Your position (sample)</h3>
									<div className={p.kpis}>
										<div className={p.kpi}>
											<span>Deposited</span>
											<b>$5,000.00</b>
										</div>
										<div className={p.kpi}>
											<span>Value now</span>
											<b>${money(5000 * RATE)}</b>
											<small>+${money(5000 * (RATE - 1))} profit</small>
										</div>
										<div className={p.kpi}>
											<span>solUSDC</span>
											<b>{money(5000 / 1, 2)}</b>
											<small>1 solUSDC = {RATE.toFixed(4)} USDC</small>
										</div>
									</div>
									<h3>solUSDC value, last 30 days (sample)</h3>
									<Chart />
									<p className={p.fine}>
										solUSDC starts at 1.0000 USDC and only rises as realized yield arrives. Profit unlocks gradually, not all at once. Past sample values say nothing
										about future results.
									</p>
								</div>

								<div className={p.card}>
									<div className={p.seg} role="group" aria-label="Action">
										<button type="button" aria-pressed={mode === "deposit"} onClick={() => setMode("deposit")}>
											Deposit
										</button>
										<button type="button" aria-pressed={mode === "withdraw"} onClick={() => setMode("withdraw")}>
											Withdraw
										</button>
									</div>
									<label className={p.field}>
										<input aria-label="Amount in USDC" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
										<span>USDC</span>
									</label>
									<div className={p.row}>
										<span>{mode === "deposit" ? "You receive" : "You burn"}</span>
										<b>{money(shares, 4)} solUSDC</b>
									</div>
									<div className={p.row}>
										<span>Sample blended rate</span>
										<b>{BLENDED.toFixed(2)}% / yr</b>
									</div>
									<div className={p.row}>
										<span>Sample yearly estimate</span>
										<b>~${money(yearly)}</b>
									</div>
									<div className={p.row}>
										<span>Deposit and withdraw fee</span>
										<b>None</b>
									</div>
									<FundNudge asset="USDC" title="Deposit USDC from any chain" text="When the vault opens, bring USDC from another chain straight to your wallet first." />
									<button type="button" className={p.cta} disabled>
										Preview only: not open for deposits
									</button>
									<p className={p.fine}>Estimates use sample rates and move with the markets. Claim profit redeems only the gain and leaves your principal working.</p>
								</div>
							</div>
						)}

						{tab === "strategies" && (
							<div className={p.body} style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
								<div className={p.card}>
									<h3>Where the vault sits (sample split)</h3>
									<div className={p.alloc} role="img" aria-label="Sample allocation across five lending markets and an idle buffer">
										{STRATEGIES.map((s) => (
											<i key={s.name} style={{ width: `${s.share}%`, background: s.color }} />
										))}
									</div>
									<div style={{ overflowX: "auto" }}>
										<table className={p.tbl}>
											<thead>
												<tr>
													<th>Market</th>
													<th>Risk tier</th>
													<th className={p.n}>Sample rate</th>
													<th className={p.n}>Share</th>
													<th className={p.n}>Cap</th>
												</tr>
											</thead>
											<tbody>
												{STRATEGIES.map((s) => (
													<tr key={s.name}>
														<td>
															<span className={p.dot} style={{ background: s.color }} />
															{s.name}
														</td>
														<td>{s.tier ? <span className={`${p.tier} ${s.tier === "A" ? p.tierA : ""}`}>Tier {s.tier}</span> : "—"}</td>
														<td className={p.n}>{s.apy ? `${s.apy.toFixed(1)}%` : "—"}</td>
														<td className={p.n}>{s.share}%</td>
														<td className={p.n}>{s.cap < 100 ? `${s.cap}%` : "—"}</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
									<p className={p.fine}>
										The market list and tiers are the planned approved list. Rates and shares are sample values. The keeper only moves money when the gain clears the
										cost of moving, and never outside the caps.
									</p>
								</div>
							</div>
						)}

						{tab === "activity" && (
							<div className={p.body} style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
								<div className={p.card}>
									<h3>Keeper activity (sample)</h3>
									<div className={p.feed}>
										{FEED.map(([t, k, d, s], i) => (
											<div className={p.ev} key={`${t}-${i}`}>
												<time>{t} UTC</time>
												<span>
													<b>{k}</b> · {d}
												</span>
												<span className={`${p.pill} ${s === "ok" ? p.pillOk : p.pillHold}`}>{s === "ok" ? "done" : "no move"}</span>
											</div>
										))}
									</div>
									<p className={p.fine}>
										Every action is logged. Early runs are planned as dry-runs, and signing is switched on only after the journal has been reviewed.
									</p>
								</div>
							</div>
						)}
					</div>
				</section>

				<div className={home.section}>
					<PrivateProof
						product="Yield Hunter"
						who="Yield Hunter is a working product that the Solve3 team can use today, on Solana devnet and on a local fork of Solana. It is not open to the public: nobody outside the team can deposit, and it holds no real money."
						built={[
							"A Solana vault program: deposit USDC, receive solUSDC, withdraw, claim profit, with caps, a liquidity buffer, a timelock and a guardian pause.",
							"Active adapters for Jupiter Lend and Kamino (MarginFi and Save are marked integration pending), and a keeper that compares markets and plans moves, dry-run first.",
							"A web app with Earn, Strategies, Activity, Opportunities, Pool, Admin and Risk pages.",
							"A private repository: 442 commits since 22 Oct 2026.",
						]}
						running={[
							"The vault program is deployed on Solana devnet, with a vault account and two token mints (test USDC and the solUSDC share token).",
							"13 transactions on the devnet vault between 23 Oct and 2 Nov 2026.",
							"The app runs end to end against a local fork that carries real Jupiter Lend programs and state, and a separate fork for Kamino.",
						]}
						tested={[
							"Type-check clean across 4 packages; 107 SDK, 54 protocol-reader, 125 keeper and 12 web tests passing, none failing, in the latest recorded run.",
							"6 browser end-to-end specs at desktop and phone sizes.",
							"A threat model with 11 categories (share inflation, donation, harvest sandwich, substituted accounts, timelock bypass and more), each tied to a test, and an audit package for an outside reviewer.",
						]}
						links={[
							{ label: "Vault program", href: EXPLORER("73KX9S6SsXd131itcu3VVdh7c8mVGgSB5DHSMyvCRtBe") },
							{ label: "Vault account", href: EXPLORER("EUUYYafsBRTTfVE8BBHzKmqQpKVjLPdkZJADG3rGPoYq") },
							{ label: "solUSDC share mint", href: EXPLORER("5p8uGHs2MyHo5D8HzRfgP1Hd8UziSXxbR6MfehbEfQGX") },
							{ label: "Test USDC mint", href: EXPLORER("6FVZFgr7stVQYwHKc1MLZ8socQtNna7G6cUEmBArZEcw") },
						]}
						shots={[
							{ src: "/assets/beta/yh-earn.png", alt: "The Yield Hunter Earn page with a deposit, share price and profit to claim", caption: "The real Earn page. A 1,000 USDC test deposit on a local fork: the deposit and withdraw box, claim profit, vault totals and the 10% performance fee." },
							{ src: "/assets/beta/yh-strategies.png", alt: "The Yield Hunter Strategies page", caption: "The real Strategies page. Rates and utilization are read from each protocol's own on-chain reserve (here, a fork of real Jupiter Lend state); two protocols are marked integration pending." },
							{ src: "/assets/beta/yh-activity.png", alt: "The Yield Hunter Activity page", caption: "The real Activity page: the test deposit with its transaction link. Withdrawals and claims appear here the same way." },
						]}
						notYet={[
							"No independent security audit yet. The app says so in its own footer.",
							"Not on mainnet and not open for deposits. Test USDC is a token we control, not real USDC.",
							"The keeper is not yet running unattended on devnet; it needs its allocator wallet funded first.",
							"The screenshots show test balances from a local fork, not earnings. Yield is never guaranteed.",
						]}
						checked="Facts checked on 5 Nov 2026 against the private repository, its latest recorded test run and Solana devnet. Screenshots come from the app's own automated browser tests."
					/>
				</div>

				<section aria-label="Safeguards" className={home.section}>
					<h2>Built with guardrails</h2>
					<p className={home.sectionLede}>What the vault design enforces, so the keeper can only act inside a box.</p>
					<div className={p.guards}>
						<div className={p.guard}>
							<span className={p.real}>FROM THE DESIGN</span>
							<b>Caps and a liquidity buffer</b>
							<p>A cap per market and a minimum idle buffer, so withdrawals stay easy and no single market holds too much.</p>
						</div>
						<div className={p.guard}>
							<span className={p.real}>FROM THE DESIGN</span>
							<b>Timelocked changes</b>
							<p>Adding a market, raising a cap or changing fees waits behind a 48-hour timelock, controlled by a multisig.</p>
						</div>
						<div className={p.guard}>
							<span className={p.real}>FROM THE DESIGN</span>
							<b>A guardian that can pause</b>
							<p>A guardian role can pause deposits and pull funds back to idle if a market looks unhealthy. The keeper can only move money between approved places.</p>
						</div>
					</div>
				</section>

				<section aria-label="How the money flows" className={home.section}>
					<h2>How the money flows</h2>
					<p className={home.sectionLede}>You deposit USDC. The keeper reads the markets and moves the vault&apos;s USDC between them. Withdrawals return to your wallet.</p>
					<YieldFlow />
				</section>

				<section aria-label="Where it stands" className={home.section}>
					<div className={css.honest}>
						<h3>Where it stands</h3>
						<ul>
							<li>Built and tested on Solana devnet with test tokens, including deposit, withdraw and claim profit.</li>
							<li>Not deployed to mainnet and not open for deposits.</li>
							<li>Launch is planned only after an independent security review and the remaining launch checks.</li>
							<li>Performance fee is proposed at 10% of profit, with no deposit or withdrawal fee. Final terms are not set.</li>
						</ul>
						<p className={css.fine}>Preview with sample data. Information only, not investment advice. Returns are never guaranteed.</p>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
};
