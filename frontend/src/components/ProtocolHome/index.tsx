"use client";

import Link from "next/link";
import { WaveBackground } from "@/components/WaveBackground";
import { Footer } from "@/components/Footer";
import { ComingSoonBadge } from "@/components/ComingSoon/ComingSoonBadge";
import { Header } from "@/components/Header";
import { INTENTS_ENABLED } from "@/configs/intents";
import { DEX_ONLY } from "@/configs/launchPhase";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { Flywheel } from "./Flywheel";
import { EpochOverview } from "./EpochOverview";
import styles from "./ProtocolHome.module.css";

const FACTS = [
	["Locks", "1 : 1", "SOLV3 locked becomes veSOLV3."],
	["Locks", "Permanent", "Locks never expire and voting power never decays."],
	["Epochs", "7 days", "Each epoch starts Thursday 00:00 UTC."],
	["Emissions", "−2%", "Emissions decay every epoch."],
] as const;


/** Set NEXT_PUBLIC_DEMO_VIDEO_URL at build time to show a "Watch the demo" button in the hero. */
const DEMO_VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL;

const TIERS = [
	["Tier 02", "Trader", 2],
	["Tier 04", "Liquidity Builder", 4],
	["Tier 03", "Liquidity Provider", 3],
] as const;

export const ProtocolHome = () => {
	const { network } = useCluster();
	const live = network === ClusterNetwork.Mainnet;
	const status = live ? "Live" : "Devnet";
	const governanceOpen = !DEX_ONLY && !GENESIS_PUBLIC_ENABLED;

	return (
		<div className={styles.page}>
			<WaveBackground />
			<Header variant="marketing" cta={governanceOpen ? { label: "This epoch", href: "/#this-epoch" } : { label: "Swap", href: "/swap" }} />

			<main className={styles.main}>
				<section className={styles.hero} id="top">
					<div className={styles.heroCopy}>
						<p className={styles.eyebrow}>
							<span className={styles.ping} />
							ve(3,3) liquidity on Solana ·{" "}
							{live ? "Live on mainnet" : "Devnet — test tokens have no monetary value"}
						</p>
						<h1>
							Direct liquidity on Solana.
							<br />
							<span className={styles.grad}>{governanceOpen ? "Vote with veSOLV3." : "veSOLV3 voting comes next."}</span>
						</h1>
						<p className={styles.lede}>
							{governanceOpen ? "Lock SOLV3 to direct weekly emissions and earn a share of trading fees and incentives from the pools you support." : "Trading and liquidity are live. veSOLV3 locks, weekly voting and voter rewards open with the governance launch."}
						</p>
						<div className={styles.actions}>
							{governanceOpen ? <Link href="/arena" className={styles.primary}>Open the Epoch Arena</Link> : <Link href="/swap" className={styles.primary}>Swap on Solana</Link>}
							{governanceOpen ? <Link href="/swap" className={styles.ghost}>Swap tokens</Link> : <a href="https://dev.solve3.fi/arena" className={styles.ghost}>Try the Epoch Arena</a>}
							{DEMO_VIDEO_URL && <a href={DEMO_VIDEO_URL} className={styles.ghost} target="_blank" rel="noopener noreferrer">Watch the demo</a>}
						</div>
						<p className={styles.small}>
							Building a Solana project? <Link href="/partners">Become a launch partner →</Link>
						</p>
					</div>

					<div className={styles.card} id="timing">
						<span className={styles.eyebrow}>How every epoch works</span>
						<ol className={styles.steps}>
							<li><span>1</span><div><strong>You vote</strong><small>veSOLV3 holders split their voting power across the pools they back.</small></div></li>
							<li><span>2</span><div><strong>Emissions follow</strong><small>SOLV3 emissions flow to each pool by vote weight, so LPs have a reason to deepen it.</small></div></li>
							<li><span>3</span><div><strong>Voters get paid</strong><small>Voters share the trading fees and bribes of the gauges they supported.</small></div></li>
						</ol>
						<div className={styles.times}>
							<div><span>Voting closes</span><b>Wed 23:55 UTC</b></div>
							<div><span>New epoch starts</span><b>Thu 00:00 UTC</b></div>
						</div>
						<small>Voting stays open all week. Rewards for votes in epoch N are claimable from epoch N+1.</small>
					</div>
				</section>

				{governanceOpen && <EpochOverview />}

				<section aria-label="Protocol parameters" className={styles.facts}>
					{FACTS.map(([label, value, text]) => (
						<div key={label + value}>
							<span className={styles.eyebrow}>{label}</span>
							<strong>{value}</strong>
							<small>{text}</small>
						</div>
					))}
				</section>

				<section className={styles.section}>
					<h2>What would you like to do?</h2>
					<div className={styles.three} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
						<Link href="/swap" className={styles.tile}>
							<span className={styles.tag}>{status}</span>
							<h3>Swap tokens</h3>
							<p>Trade Solana tokens through concentrated-liquidity pools.</p>
							<span className={styles.more}>Open swap →</span>
						</Link>
						<Link href="/liquidity" className={styles.tile}>
							<span className={styles.tag}>{status}</span>
							<h3>Provide liquidity</h3>
							<p>Pick a pool and a range — Narrow, Balanced, Wide or Full — and put your tokens to work.</p>
							<span className={styles.more}>Explore pools →</span>
						</Link>
						<Link href="/arena" className={styles.tile}>
							<span className={styles.tag}>{governanceOpen ? status : <ComingSoonBadge short />}</span>
							<h3>Epoch Arena</h3>
							<p>{governanceOpen ? "Vote with veSOLV3, add liquidity to the contenders and claim what they earn." : "See which pools lead and add liquidity. Voting and emissions open with the veSOLV3 launch."}</p>
							<span className={styles.more}>Enter the Arena →</span>
						</Link>
						{INTENTS_ENABLED && (
							<Link href="/fund" className={styles.tile}>
								<span className={styles.tag}>{status}</span>
								<h3>Bring assets from any chain</h3>
								<p>Pay from another chain and receive SOL or USDC on Solana. Moves real assets and settles on Solana mainnet.</p>
								<span className={styles.more}>Fund your wallet →</span>
							</Link>
						)}
					</div>
				</section>

				<section className={styles.section} id="loop">
					<span className={styles.eyebrow}>The loop{!governanceOpen && <> <ComingSoonBadge /></>}</span>
					<h2>Projects fund incentives. Voters direct emissions.</h2>
					<p className={styles.sectionLede}>
						Every week, veSOLV3 holders direct SOLV3 emissions to pools. Those rewards can attract liquidity, while voters share the trading fees and funded incentives of the gauges they support.
					</p>
					<Flywheel />
				</section>

				<section className={styles.audiences}>
					<div className={styles.tile}>
						<span className={styles.eyebrow}>For traders, LPs &amp; voters</span>
						<h3>Your vote supports the pools you choose.</h3>
						<p>LPs supply the pools. veSOLV3 holders direct emissions through weekly votes and share the funded rewards of the gauges they back.</p>
						<div className={styles.actions}>
							<Link href="/swap" className={styles.primary}>Open app</Link>
							{governanceOpen && <Link href="/simulator" className={styles.ghost}>Model rewards</Link>}
						</div>
					</div>
					<div className={styles.tile}>
						<span className={styles.eyebrow}>For Solana projects</span>
						<h3>Turn rewards into deeper liquidity.</h3>
						<p>Put incentives behind your pool, attract votes, and let SOLV3 emissions compound what you spend. Start with a 30-day pilot — no investment required. Selected projects can also apply for Accelerator vote matching.</p>
						<div className={styles.actions}>
							<Link href="/partners" className={styles.primary}>Become a launch partner</Link>
						</div>
					</div>
				</section>

				<section className={styles.section} id="growth">
					<span className={styles.eyebrow}>Liquidity &amp; community</span>
					<h2>Liquidity brings traders. Votes build community.</h2>
					<p className={styles.sectionLede}>
						Deeper pools mean better prices and more trading. Solve3&apos;s ve(3,3) design then turns the people who vote for your pool into a committed community around it.
					</p>
					<div className={styles.three}>
						<div className={styles.tile}>
							<span className={styles.eyebrow}>1 · Provide liquidity</span>
							<h3>Put capital where it trades.</h3>
							<p>Concentrated pools on Solana with eight fee tiers, from 0.01% to 2%. Pick a range preset or set your own.</p>
							<Link href="/liquidity" className={styles.more}>Browse pools →</Link>
						</div>
						<div className={styles.tile}>
							<span className={styles.eyebrow}>2 · Earn your place{DEX_ONLY && <> <ComingSoonBadge /></>}</span>
							<h3>Quests reward real activity.</h3>
							<p>Swap, add liquidity and keep it there. Earn XP, climb tiers and keep your record on your Solve3 Pass.</p>
							<ul>
								<li>Make your first swap</li>
								<li>Provide liquidity to a featured pool</li>
								<li>Keep liquidity deposited for 7 days</li>
							</ul>
							<p className={styles.small}>Rewards are provisional until campaign review.</p>
							<div className={styles.links}>
								<Link href="/quests" className={styles.more}>See quests →</Link>
								<Link href="/quests?tab=pass" className={styles.more}>Your Pass →</Link>
							</div>
						</div>
						<div className={styles.tile}>
							<span className={styles.eyebrow}>3 · The ve(3,3) engine</span>
							<h3>Votes turn holders into your community.</h3>
							<p>To earn from your pool, voters lock SOLV3 and back your gauge every epoch. That makes them invested in your project, not just passing traders.</p>
							<ul>
								<li>Your bribes give voters a reason to back you.</li>
								<li>Votes steer SOLV3 emissions to your pool.</li>
								<li>Deeper liquidity brings more trading, fees and bribes.</li>
							</ul>
						</div>
					</div>
				</section>

				{!live && (
					<section className={styles.section} id="next">
						<span className={styles.eyebrow}>What&apos;s next</span>
						<h2>Two products in preview.</h2>
						<p className={styles.sectionLede}>Both run on sample data in preview and are not open for deposits.</p>
						<div className={styles.three} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
							<Link href="/beta/alm-market" className={styles.tile}>
								<span className={styles.tag}>Preview</span>
								<h3>ALM</h3>
								<p>Know when not to provide liquidity: fees against price swings, compared with holding.</p>
								<span className={styles.more}>See the market view →</span>
							</Link>
							<Link href="/beta/yield-hunter" className={styles.tile}>
								<span className={styles.tag}>Preview</span>
								<h3>Yield Hunter</h3>
								<p>A USDC vault that spreads deposits across Solana lending markets, within caps and a liquidity buffer.</p>
								<span className={styles.more}>See the preview →</span>
							</Link>
						</div>
					</section>
				)}

				<section className={styles.pass} id="pass">
					<div className={styles.passCopy}>
						<span className={styles.eyebrow}>Solve3 Pass{DEX_ONLY && <> <ComingSoonBadge /></>}</span>
						<h2>
							Your on-chain record. <span className={styles.grad}>Your legend.</span>
						</h2>
						<p>The Pass is an NFT that holds every Quest XP and Voting XP your wallet earns. One per wallet, and its tier and artwork evolve as you do.</p>
						<ul>
							<li>Quest XP from trading, liquidity, referrals and community</li>
							<li>Voting XP for every epoch you vote</li>
							<li>Five tiers, from Explorer to Founding LP</li>
						</ul>
						<div className={styles.actions}>
							<Link href="/quests?tab=pass" className={styles.primary}>Get your Pass</Link>
							<Link href="/quests" className={styles.ghost}>See quests</Link>
						</div>
					</div>
					<div className={styles.passArt}>
						{TIERS.map(([label, name, art]) => (
							<div key={name} className={styles.passCard}>
								{/* biome-ignore lint/performance/noImgElement: static SVG artwork */}
								<img src={`/assets/pass/tier-${art}.svg`} alt="" />
								<span>{label}</span>
								<strong>{name}</strong>
							</div>
						))}
					</div>
				</section>

				<section className={styles.final}>
					<h2>
						Trade. Provide. <span className={styles.grad}>Vote.</span>
					</h2>
					<p>
						{!governanceOpen ? "Swap and provide liquidity on mainnet. Try the weekly voting cycle on Devnet." : live
							? "Solve3 is live on Solana mainnet. Swap, add liquidity and vote with SOLV3."
							: "Solve3 runs on Solana devnet. Swap, add liquidity and vote with SOLV3 test tokens."}
					</p>
					<div className={styles.actions}>
						<Link href={governanceOpen ? "/arena" : "/swap"} className={styles.primary}>{governanceOpen ? "Open the Arena" : "Swap tokens"}</Link>
						<a href="https://discord.gg/ZDyXeyjGc7" className={styles.ghost}>Join Discord</a>
					</div>
				</section>
			</main>

			<Footer variant="marketing" extras />
		</div>
	);
};
