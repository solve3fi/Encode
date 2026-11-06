"use client";

import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import home from "@/components/ProtocolHome/ProtocolHome.module.css";
import extra from "./AgentIntro.module.css";

const FACTS = [
	["Custody", "None", "You sign every transaction in your own wallet. The agent never holds your keys."],
	["To claim", "1 click", "Every unclaimed voting reward, packed into the fewest transactions."],
	["Voting", "Weekly", "Vote yourself, or switch on auto-vote and never miss a week."],
	["For software", "x402", "A pay-per-call API so other agents and bots can use it too."],
] as const;

const FEATURES = [
	[
		"01",
		"Claim everything",
		"It scans every week you voted, finds each reward (trading fees, bribes and emissions), and bundles them so one press collects them all. Each transaction is simulated before you sign.",
	],
	[
		"02",
		"Vote with a plan",
		"See every pool's share of the votes, pick your split with simple percent boxes, and watch it on a bar. When prices exist, the agent also suggests the split with the best expected return.",
	],
	[
		"03",
		"Auto-vote, set and forget",
		"Turn it on per lock and the agent votes near the end of each week. Your own vote always wins, and the one cost (15% of voting rewards for weeks it votes) is shown before you agree.",
	],
] as const;

const STEPS = [
	["01", "Connect", "Open the agent with a Solana wallet on Devnet. Nothing to install and no account to make."],
	["02", "Lock", "Lock SOLV3 for permanent voting power: 1 SOLV3 is 1 veSOLV3 that never decays."],
	["03", "Choose", "Vote yourself, or let the agent do it. Voting closes five minutes before each week ends."],
	["04", "Claim", "When the week rolls over, press Claim all and sign. That's it."],
] as const;

const FAQ = [
	[
		"Can the agent take my tokens?",
		"No. It only builds transactions. You review and sign each one in your wallet, so it can never move anything on its own. The auto-vote helper can cast votes for locks whose owners chose it, and nothing else.",
	],
	[
		"What does auto-vote cost?",
		"While the agent votes a lock for you, 15% of that lock's voting rewards (trading fees and bribes) go to the protocol. This is an on-chain rule, not an agent fee. Weeks you vote yourself have no cost, and you can switch it off any time.",
	],
	[
		"Will it make me more money?",
		"We can't promise returns. The agent helps you not miss votes or rewards, and suggests splits using the data it can see. On Devnet, tokens have no price, so suggestions are basic. Treat anything it shows as an estimate.",
	],
	[
		"Is this live on mainnet?",
		"Not yet. This is a Devnet beta: all tokens are test tokens with no monetary value. The agent will not run on mainnet until the protocol itself is deployed and verified there.",
	],
	[
		"What is x402?",
		"A way for software to pay for an API per request, using a stablecoin, with no accounts or keys to manage. The agent's API speaks x402, so a bot can ask a question, pay a few cents, and get an answer.",
	],
] as const;

export const AgentIntro = () => (
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
						<span className={home.ping} />
						Solve3 Agent · Devnet beta — test tokens, no monetary value
					</p>
					<h1>
						Vote smarter.
						<br />
						<span className={home.grad}>Never miss a reward.</span>
					</h1>
					<p className={home.lede}>
						Your weekly ve(3,3) co-pilot. The Solve3 Agent finds what you can claim, helps you pick where to vote, and can even vote for you. You always sign, and it never holds your keys.
					</p>
					<div className={home.actions}>
						<Link href="/beta/agent" className={home.primary}>Open the agent</Link>
						<Link href="/beta/agent?demo=1" className={home.ghost}>See it with sample data</Link>
					</div>
					<p className={home.small}>
						Building a bot or using Claude or Codex? <Link href="/beta/agent/api">Use the pay-per-call API →</Link>
					</p>
				</div>

				<div className={extra.mock} role="img" aria-label="Illustration of the agent: a lock with auto-vote on, a vote split bar and a Claim all button">
					<div className={extra.mockTop}>
						<span><b>Lock #6</b> · 1,500 SOLV3</span>
						<span className={`${extra.chip} ${extra.chipGood}`}>Auto-vote ON</span>
					</div>
					<div className={extra.mockBar}>
						<i style={{ width: "40%", background: "#685df7" }} />
						<i style={{ width: "35%", background: "#58d7ff" }} />
						<i style={{ width: "25%", background: "#f5b14c" }} />
					</div>
					<div className={extra.mockRow}><span>SOLV3 / devUSDC</span><small>40%</small></div>
					<div className={extra.mockRow}><span>SOL / devUSDC</span><small>35%</small></div>
					<div className={extra.mockRow}><span>Third pool</span><small>25%</small></div>
					<div className={extra.mockRow}>
						<span>3 rewards ready</span>
						<span className={`${extra.chip} ${extra.chipInfo}`}>Voting open</span>
					</div>
					<div className={extra.mockBtn}>Claim all</div>
					<p className={extra.fine}>Illustration. Not live data.</p>
				</div>
			</section>

			<section aria-label="Open the agent app" className={home.section}>
				<Link href="/beta/agent" className={extra.launch}>
					<span className={extra.launchText}>
						<strong>Solve3 Agent app</strong>
						<span>
							Connect your wallet to see your locks and rewards, get a suggested vote split, claim everything in one go and turn on auto-vote. You review and sign every transaction.
						</span>
					</span>
					<span className={extra.launchGo}>Open the agent →</span>
				</Link>
			</section>

			<section aria-label="Why use the agent" className={home.facts}>
				{FACTS.map(([label, value, text]) => (
					<div key={label}>
						<span className={home.eyebrow}>{label}</span>
						<strong>{value}</strong>
						<small>{text}</small>
					</div>
				))}
			</section>

			<section className={home.section}>
				<span className={home.eyebrow}>What it does</span>
				<h2>
					Three jobs, <span className={home.grad}>done for you.</span>
				</h2>
				<div className={home.three}>
					{FEATURES.map(([n, title, text]) => (
						<div key={n} className={home.tile}>
							<span className={home.eyebrow}>{n}</span>
							<h3>{title}</h3>
							<p>{text}</p>
						</div>
					))}
				</div>
			</section>

			<section className={home.section}>
				<span className={home.eyebrow}>How it works</span>
				<h2>
					From lock to rewards in <span className={home.grad}>four steps.</span>
				</h2>
				<div className={home.four}>
					{STEPS.map(([n, title, text]) => (
						<div key={n} className={home.tile}>
							<span className={home.eyebrow}>{n}</span>
							<h3>{title}</h3>
							<p>{text}</p>
						</div>
					))}
				</div>
			</section>

			<section className={home.section} id="api">
				<span className={home.eyebrow}>For developers and AI agents</span>
				<h2>
					Pay per request. <span className={home.grad}>No accounts.</span>
				</h2>
				<p className={home.sectionLede}>
					Everything the page does is available as an HTTP API that bills with x402. Your software asks, gets a 402 Payment Required with the price, pays a few cents in a stablecoin, and receives the answer or a ready-to-sign transaction. No keys to manage, no subscription and nothing to buy in advance.
				</p>
				<div className={home.actions}>
					<Link href="/beta/agent/api" className={home.primary}>How the API works</Link>
					<Link href="/beta/agent/api/setup" className={home.ghost}>Set it up (Claude, Codex, scripts)</Link>
				</div>
				<div className={home.three}>
					<div className={home.tile}>
						<h3>Read data</h3>
						<div className={extra.price}><b>$0.005</b><span>per call · devnet USDC</span></div>
						<ul className={extra.list}>
							<li>Locks and claimable rewards for any wallet</li>
							<li>This week's pools and vote shares</li>
							<li>A suggested vote split for a lock</li>
							<li>Auto-vote status</li>
						</ul>
					</div>
					<div className={home.tile}>
						<h3>Build transactions</h3>
						<div className={extra.price}><b>$0.02</b><span>per call · devnet USDC</span></div>
						<ul className={extra.list}>
							<li>Claim every reward in one request</li>
							<li>Vote with an optimised or custom split</li>
							<li>Lock, add to a lock, turn auto-vote on or off</li>
							<li>Always returned unsigned and pre-simulated</li>
						</ul>
					</div>
					<div className={home.tile}>
						<h3>How a call goes</h3>
						<pre className={extra.code}>
							<em># 1. ask</em>{"\n"}
							GET <b>/v1/claimable/&lt;wallet&gt;</b>{"\n"}
							<em># 2. server replies 402 with the price</em>{"\n"}
							<em># 3. your x402 client pays and retries</em>{"\n"}
							<em># 4. you get JSON, or a tx to sign</em>
						</pre>
						<p className={home.small}>If a request fails, you aren't charged.</p>
					</div>
				</div>
			</section>

			<section className={home.section}>
				<span className={home.eyebrow}>Questions</span>
				<h2>Straight answers.</h2>
				<div className={extra.faq}>
					{FAQ.map(([q, a]) => (
						<details key={q}>
							<summary>{q}</summary>
							<p>{a}</p>
						</details>
					))}
				</div>
			</section>

			<section className={home.final}>
				<h2>
					Try it on <span className={home.grad}>Devnet.</span>
				</h2>
				<p>Connect a wallet, lock some test SOLV3, and let the agent handle the weekly routine.</p>
				<div className={home.actions}>
					<Link href="/beta/agent" className={home.primary}>Open the agent</Link>
					<Link href="/beta/agent?demo=1" className={home.ghost}>Preview with sample data</Link>
				</div>
				<p className={extra.disclaimer}>
					Devnet beta. Test tokens have no monetary value. Nothing here is financial advice or a promise of returns.
				</p>
			</section>
		</main>

		<Footer variant="marketing" extras />
	</div>
);
