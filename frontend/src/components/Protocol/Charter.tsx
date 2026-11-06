import Link from "next/link";
import { ComingSoonBadge } from "@/components/ComingSoon/ComingSoonBadge";
import { AddressValue } from "@/components/Token/AddressValue";
import {
	DEVNET_DEX_PROGRAM_ADDRESS,
	DEVNET_VE_PROGRAM_ADDRESS,
} from "@/configs/addresses";
import { AUDIT_URL } from "@/configs/audit";
import { GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";
import { DEX_ONLY } from "@/configs/launchPhase";
import { SOLVE } from "@/configs/tokens";
import styles from "./ProtocolPages.module.css";

const showVotingLink = !GENESIS_PUBLIC_ENABLED && !DEX_ONLY;

const vocabulary = [
	{
		term: "SOLV3",
		plain: "The protocol token.",
		detail:
			"SOLV3 powers the incentive system and can be locked to create voting power.",
	},
	{
		term: "veSOLV3",
		plain: "Your voting power.",
		detail:
			"Lock SOLV3 to create veSOLV3 and vote on where scheduled rewards go.",
	},
	{
		term: "Gauge",
		plain: "A reward bucket for a liquidity pool.",
		detail:
			"Votes determine how much of the scheduled SOLV3 reward each eligible gauge receives.",
	},
	{
		term: "Epoch",
		plain: "Solve3's weekly cycle.",
		detail:
			"Voting, emissions, settlement, and rewards are organized into seven-day epochs.",
	},
];

const features = [
	{
		tag: "Everywhere",
		title: "Just Ask",
		hook: "Skip the menus. Just say what you want.",
		body: 'Press Ctrl/Cmd K and type "Swap 100 USDC for SOLV3", "Lock all my SOLV3" or "When does the epoch end?". Just Ask shows what it means and opens the right page, already filled in. It also answers quick questions like the SOL price and your balance. You always review and sign yourself.',
	},
	{
		tag: "Devnet",
		title: "Public Auto-Vote",
		hook: "Set it once. Your lock keeps voting.",
		body: "Forget to vote and you miss out. Enroll a lock in Auto-Vote and a keeper votes it for you each epoch. Your veSOLV3 never leaves your wallet, you can switch voters or revoke any time, and the fee is 15% of voting rewards.",
	},
	{
		tag: "Devnet",
		title: "Claim all + Lock + Merge",
		hook: "Compound your rewards in one tap.",
		body: "On the Rewards page, one button claims every reward, locks the SOLV3 you just received, and merges your eligible locks into your biggest one. One position, more voting power. Locks that already voted this epoch are skipped and listed, never forced.",
	},
	{
		tag: "Everywhere",
		title: "Zero-friction partner portal",
		hook: "From token to live incentives, step by step.",
		body: "Whitelisted or not, the portal walks projects through verifying a mint, creating a pool, adding liquidity, adding rewards and voting, with a clear checklist. Selected projects can also apply for Accelerator vote matching.",
	},
	{
		tag: "Everywhere",
		title: "The Solve3 Pass",
		hook: "Your activity, on one evolving NFT.",
		body: "One free Pass per wallet collects your Quest XP and Voting XP, and its tier and artwork grow as you do. Climb the leaderboard just by using the protocol.",
	},
	{
		tag: "Everywhere",
		title: "Live stats at a glance",
		hook: "See the market before you click.",
		body: "The ribbon on the main site shows SOL's price, total liquidity, volume and estimated fees, and the Pools price chart shows your range at a glance before you add liquidity.",
	},
] as const;

const flywheel = [
	["Project", "Adds rewards"],
	["Users", "Vote"],
	["Protocol", "Routes SOLV3 rewards"],
	["LPs", "Earn"],
	["Market", "Liquidity can grow"],
];

const epochSteps = [
	{
		when: "Thursday · 00:00 UTC",
		title: "New epoch",
		body: "A new seven-day cycle begins. Each epoch lasts exactly 604,800 seconds.",
	},
	{
		when: "During the week",
		title: "Users vote",
		body: "veSOLV3 holders allocate voting power to eligible gauges. Voting closes five minutes before the boundary.",
	},
	{
		when: "Epoch end",
		title: "Votes become final",
		body: "Final weights determine how the scheduled reward is divided. A protected keeper currently submits admin-authorized settlement.",
	},
	{
		when: "Next epoch",
		title: "Rewards flow",
		body: "Eligible gauges receive SOLV3 according to finalized vote weights; eligible LP positions earn under the deployed liquidity rules.",
	},
];

const parameters = [
	["Epoch", "7 days"],
	["Epoch start", "Thursday · 00:00 UTC"],
	["Epoch length", "604,800 seconds"],
	["Initial emission", "1,300,000 SOLV3"],
	["Emission decay", "2% per epoch"],
	["Voting power", "1 SOLV3 locked = 1 veSOLV3"],
	["Vote cutoff", "5 minutes before epoch end"],
	["Voter reward delay", "N + 1"],
	["Genesis supply", "100M SOLV3"],
	["Maximum scheduled emissions", "65M SOLV3"],
	["Theoretical maximum supply", "165M SOLV3"],
];

const emissionPoints = Array.from({ length: 53 }, (_, index) => {
	const x = 28 + (index / 52) * 644;
	const emission = 1_300_000 * 0.98 ** index;
	const y = 28 + (1 - emission / 1_300_000) * 172;
	return `${x.toFixed(1)},${y.toFixed(1)}`;
}).join(" ");

const milestoneEmission = (epoch: number) =>
	`${((1_300_000 * 0.98 ** (epoch - 1)) / 1_000_000).toFixed(2)}M`;

export const Charter = () => (
	<article className={`${styles.page} ${styles.charter}`}>
		<section className={styles.charterHero} aria-labelledby="charter-title">
			<div className={styles.heroCopy}>
				<div className={styles.eyebrow}>Solve3 protocol charter</div>
				<h1 className={styles.title} id="charter-title">
					Understand Solve3 in <em>five minutes.</em>
				</h1>
				<p className={styles.heroThesis}>
					Projects add rewards.
					<br />
					Users vote.
					<br />
					Liquidity follows.
				</p>
				<p className={styles.lede}>
					Solve3 is the liquidity growth layer for Solana. It uses incentives
					and voting to direct scheduled liquidity rewards toward the markets
					participants choose to support.
				</p>
				<p className={styles.heroDetail}>
					Lock SOLV3 to get voting power. Vote for liquidity pools. Votes
					determine where scheduled SOLV3 rewards go. Projects can add extra
					incentives to make their pools more attractive.
				</p>
			</div>
			<nav className={styles.heroRail} aria-label="How to read this charter">
				<span className={styles.dataLabel}>Reading path</span>
				<ol>
					<li>
						<strong>Learn</strong>
						<span>The simple model</span>
					</li>
					<li>
						<strong>Understand</strong>
						<span>How it works</span>
					</li>
					<li>
						<strong>Inspect</strong>
						<span>What's deployed</span>
					</li>
					<li>
						<strong>Verify</strong>
						<span>Rules and addresses</span>
					</li>
				</ol>
				{showVotingLink ? (
					<Link href="/arena">
						Go to Vote <span aria-hidden="true">→</span>
					</Link>
				) : (
					<ComingSoonBadge />
				)}
			</nav>
		</section>

		<div className={styles.quickStats}>
			{[
				["Epoch", "7 days"],
				["Starts", "Thursday · 00:00 UTC"],
				["First emission", "1.30M SOLV3"],
				["Weekly decay", "2%"],
			].map(([label, value]) => (
				<div key={label}>
					<span>{label}</span>
					<strong>{value}</strong>
				</div>
			))}
		</div>

		<nav className={styles.charterNav} aria-label="Charter sections">
			<a href="#features">Features</a>
			<a href="#learn">Learn</a>
			<a href="#understand">Understand</a>
			<a href="#inspect">Inspect</a>
			<a href="#verify">Verify</a>
		</nav>
		<p className={styles.testingNotice}>
			<span>Deployment note</span> The current veSOLV3 program and addresses
			documented below are devnet-only. Test tokens have no monetary value.
		</p>

		<section
			className={styles.section}
			id="features"
			aria-labelledby="features-title"
		>
			<div className={styles.sectionHeader}>
				<div>
					<div className={styles.eyebrow}>Discover · Features</div>
					<h2 className={styles.sectionTitle} id="features-title">
						Cool things you can do.
					</h2>
				</div>
				<p className={styles.sectionIntro}>
					Solve3 has a few shortcuts that are easy to miss. Here are some
					worth knowing about.
				</p>
			</div>
			<ul className={styles.featureGrid}>
				{features.map((feature) => (
					<li key={feature.title} className={styles.featureCard}>
						<span className={styles.featureTag}>{feature.tag}</span>
						<h3>{feature.title}</h3>
						<strong>{feature.hook}</strong>
						<p>{feature.body}</p>
					</li>
				))}
			</ul>
		</section>

		<section
			className={styles.section}
			id="learn"
			aria-labelledby="learn-title"
		>
			<div className={styles.sectionHeader}>
				<div>
					<div className={styles.eyebrow}>Learn · 30 seconds</div>
					<h2 className={styles.sectionTitle} id="learn-title">
						How Solve3 grows liquidity
					</h2>
				</div>
				<p className={styles.sectionIntro}>
					Projects can compete for attention by adding rewards. Voters decide
					which eligible markets receive the protocol's scheduled rewards,
					giving LPs another reason to provide liquidity there.
				</p>
			</div>
			<ol className={styles.flywheel} aria-label="Solve3 liquidity flywheel">
				{flywheel.map(([label, action], index) => (
					<li className={styles.flywheelStep} key={action}>
						<span>{label}</span>
						<strong>{action}</strong>
						{index < flywheel.length - 1 && <i aria-hidden="true">→</i>}
					</li>
				))}
			</ol>
			<p className={styles.caption}>
				More rewards can make a pool more attractive to LPs. More liquidity and
				activity may create more trading activity and fees, continuing the
				cycle. Incentives do not guarantee votes, liquidity, or returns.
			</p>

			<div className={styles.subsectionHeading}>
				<div className={styles.eyebrow}>The vocabulary</div>
				<h3>Four concepts unlock the rest.</h3>
			</div>
			<div className={styles.vocabularyGrid}>
				{vocabulary.map((item) => (
					<article className={styles.vocabularyCard} key={item.term}>
						<span>{item.term}</span>
						<h4>{item.plain}</h4>
						<p>{item.detail}</p>
					</article>
				))}
			</div>
		</section>

		<section
			className={styles.section}
			id="understand"
			aria-labelledby="understand-title"
		>
			<div className={styles.sectionHeader}>
				<div>
					<div className={styles.eyebrow}>Understand · The mechanics</div>
					<h2 className={styles.sectionTitle} id="understand-title">
						Lock. Vote. Direct rewards.
					</h2>
				</div>
				<p className={styles.sectionIntro}>
					SOLV3 is the protocol token. Locking it creates veSOLV3 voting power—a
					position that participates in gauge voting, not a normal freely
					tradable token.
				</p>
			</div>

			<div className={styles.lockGrid}>
				<article className={styles.lockEquation}>
					<span className={styles.dataLabel}>Voting power</span>
					<strong>
						<b>1 SOLV3</b> locked <i>=</i> <b>1 veSOLV3</b>
					</strong>
					<p>
						A permanent lock does not automatically expire or lose voting power
						over time.
					</p>
				</article>
				<article className={styles.exitCard}>
					<span className={styles.noteStatus}>Supported paid exit</span>
					<h3>What if I want to unlock?</h3>
					<p>
						The exit returns the locked SOLV3 principal and charges SOL equal to{" "}
						<strong>40% of the published SOL value</strong> of the position.
					</p>
					<p>
						The configured administrator publishes the SOLV3/SOL conversion
						rate. It is not a permissionless oracle. Review the quoted cost
						before approving.
					</p>
				</article>
			</div>

			<div className={styles.explainerGrid}>
				<article className={styles.gaugeExample}>
					<div className={styles.cardHeading}>
						<div>
							<span className={styles.dataLabel}>Example only</span>
							<h3>What's a gauge?</h3>
						</div>
						<p>A reward bucket for an eligible liquidity pool.</p>
					</div>
					<div className={styles.voteBars}>
						{[
							["Pool A", 50],
							["Pool B", 30],
							["Pool C", 20],
						].map(([pool, percent]) => (
							<div key={pool}>
								<span>{pool}</span>
								<i>
									<b style={{ width: `${percent}%` }} />
								</i>
								<strong>{percent}%</strong>
							</div>
						))}
					</div>
					<p>
						In this simplified example, each pool receives the same share of
						vote-directed emissions as its share of final votes.
					</p>
				</article>
				<article className={styles.incentiveCard}>
					<span className={styles.dataLabel}>Project incentives</span>
					<h3>Projects can compete for votes.</h3>
					<ol>
						<li>Project adds rewards</li>
						<li>Gauge becomes more attractive</li>
						<li>More votes can direct more SOLV3</li>
						<li>LP rewards can become more attractive</li>
						<li>More liquidity may follow</li>
					</ol>
					<p>
						Project incentives are also called gauge incentives or “bribes” in
						ve(3,3) terminology. Adding them does not guarantee votes,
						emissions, or liquidity.
					</p>
				</article>
			</div>

			<aside className={styles.howWhereCallout}>
				<div>
					<span>How much?</span>
					<strong>The schedule decides.</strong>
					<p>
						The weekly amount starts at 1.3M SOLV3 and declines automatically.
					</p>
				</div>
				<div>
					<span>Where?</span>
					<strong>veSOLV3 voters decide.</strong>
					<p>Final votes divide that amount among eligible gauges.</p>
				</div>
				<footer>
					The schedule controls <b>how much.</b> Voting controls{" "}
					<b>where it goes.</b>
				</footer>
			</aside>

			<div className={styles.subsectionHeading}>
				<div className={styles.eyebrow}>The weekly cycle</div>
				<h3>One week. One voting cycle.</h3>
			</div>
			<div className={styles.epochTimeline}>
				{epochSteps.map((step, index) => (
					<article key={step.title}>
						<span>{String(index + 1).padStart(2, "0")}</span>
						<small>{step.when}</small>
						<h4>{step.title}</h4>
						<p>{step.body}</p>
					</article>
				))}
			</div>

			<div className={styles.rewardDelay}>
				<div>
					<span className={styles.dataLabel}>When voters get rewards</span>
					<h3>Vote now. Claim later.</h3>
					<p>
						Fees and project incentives from voting in epoch N become claimable
						from epoch N+1.
					</p>
				</div>
				<ol aria-label="N plus one reward timeline">
					<li>
						<small>Vote</small>
						<strong>Epoch N</strong>
					</li>
					<li>
						<small>Claim</small>
						<strong>Epoch N+1</strong>
					</li>
				</ol>
			</div>
		</section>

		<section className={styles.section} aria-labelledby="emissions-title">
			<div className={styles.sectionHeader}>
				<div>
					<div className={styles.eyebrow}>Understand · Token emissions</div>
					<h2 className={styles.sectionTitle} id="emissions-title">
						SOLV3 rewards shrink every week.
					</h2>
				</div>
				<p className={styles.sectionIntro}>
					The amount follows a predetermined schedule. Each new emission is 98%
					of the previous emission; an operator does not choose the weekly
					amount.
				</p>
			</div>
			<div className={styles.emissionsPanel}>
				<div className={styles.chartCopy}>
					<span className={styles.dataLabel}>Scheduled SOLV3 per epoch</span>
					<strong>
						Emission(n) = 1,300,000 × 0.98<sup>(n−1)</sup>
					</strong>
					<p>
						Approximate milestones from the published formula—not a token-price
						chart.
					</p>
				</div>
				<div className={styles.chartWrap}>
					<svg
						className={styles.emissionChart}
						viewBox="0 0 700 250"
						role="img"
						aria-labelledby="emission-chart-title emission-chart-desc"
					>
						<title id="emission-chart-title">
							Declining scheduled SOLV3 emissions
						</title>
						<desc id="emission-chart-desc">
							A curve declining from 1.30 million SOLV3 in epoch 1 to
							approximately 0.46 million by epoch 52.
						</desc>
						<line x1="28" y1="200" x2="672" y2="200" />
						<line x1="28" y1="28" x2="28" y2="200" />
						<polyline points={emissionPoints} />
						{[1, 13, 26, 52].map((epoch) => {
							const x = 28 + ((epoch - 1) / 52) * 644;
							const y =
								28 + (1 - (1_300_000 * 0.98 ** (epoch - 1)) / 1_300_000) * 172;
							return (
								<g key={epoch}>
									<circle cx={x} cy={y} r="4" />
									<text x={x} y="228" textAnchor="middle">
										E{epoch}
									</text>
								</g>
							);
						})}
					</svg>
					<div className={styles.chartMilestones}>
						{[1, 13, 26, 52].map((epoch) => (
							<span key={epoch}>
								<small>Epoch {epoch}</small>
								<strong>≈ {milestoneEmission(epoch)}</strong>
							</span>
						))}
					</div>
				</div>
			</div>

			<div className={styles.supplyPanel}>
				<div>
					<span className={styles.eyebrow}>Supply model</span>
					<h3>Where does SOLV3 supply end up?</h3>
					<p>
						Weekly emissions form a declining geometric series: 1,300,000 ÷ (1 −
						0.98) = 65,000,000.
					</p>
				</div>
				<div
					className={styles.supplyEquation}
					role="img"
					aria-label="100 million genesis supply plus up to 65 million scheduled emissions equals a 165 million theoretical maximum supply"
				>
					<span>
						<small>Genesis supply</small>
						<strong>100M</strong>
					</span>
					<i>+</i>
					<span>
						<small>Max scheduled emissions</small>
						<strong>65M</strong>
					</span>
					<i>=</i>
					<span className={styles.supplyTotal}>
						<small>Theoretical maximum</small>
						<strong>165M</strong>
					</span>
				</div>
				<blockquote>
					Under the current emission schedule, and assuming no other mint or
					burn mechanism changes supply, total SOLV3 supply approaches a
					theoretical maximum of 165M SOLV3.
				</blockquote>
			</div>
		</section>

		<section className={styles.section} id="pass" aria-labelledby="pass-title">
			<div className={styles.sectionHeader}>
				<div>
					<div className={styles.eyebrow}>Understand · The Solve3 Pass</div>
					<h2 className={styles.sectionTitle} id="pass-title">
						One Pass per wallet.
					</h2>
				</div>
				<p className={styles.sectionIntro}>
					The Solve3 Pass is an NFT that holds a wallet&apos;s Quest XP and
					Voting XP. Its tier and artwork evolve as XP grows.
				</p>
			</div>
			<ol className={styles.reading}>
				<li>
					<strong>Tiers.</strong> Explorer, Trader, Liquidity Provider,
					Liquidity Builder and Founding LP.
				</li>
				<li>
					<strong>Quest XP.</strong> Earned from reviewed trading, liquidity,
					referral and community activity.
				</li>
				<li>
					<strong>Voting XP.</strong> Earned by voting on gauges each epoch.
				</li>
				<li>
					<strong>Provisional.</strong> XP reflects reviewed activity and does
					not guarantee rewards, allocations or returns.
				</li>
			</ol>
		</section>

		<section
			className={`${styles.section} ${styles.inspectSection}`}
			id="inspect"
			aria-labelledby="inspect-title"
		>
			<div className={styles.phaseDivider}>
				<span>From model to deployment</span>
			</div>
			<div className={styles.sectionHeader}>
				<div>
					<div className={styles.eyebrow}>Inspect · Deployment state</div>
					<h2 className={styles.sectionTitle} id="inspect-title">
						What's deployed today?
					</h2>
				</div>
				<p className={styles.sectionIntro}>
					The repository represents more than one fee model and deployment
					stage. They are separated here so planned mechanics are not mistaken
					for live behavior.
				</p>
			</div>
			<div className={styles.deploymentGrid}>
				<article>
					<span className={`${styles.statusBadge} ${styles.statusClosed}`}>
						Not represented as live
					</span>
					<h3>Mainnet DEX</h3>
					<p>
						The canonical config marks the former mainnet Solve program as
						closed and says a real mainnet redeploy has not happened. This
						Charter does not present mainnet pools as active.
					</p>
				</article>
				<article>
					<span className={`${styles.statusBadge} ${styles.statusTesting}`}>
						Devnet · testing
					</span>
					<h3>Current gauge fee policy</h3>
					<p>
						Verified deployment records show gaugeless pools at{" "}
						<strong>0% protocol / 100% LP</strong> and pools with a canonical
						gauge at <strong>80% protocol / 20% LP</strong>.
					</p>
					<small>
						Those protocol balances are intended for gauge routing, but the
						September 14 audit records a separate routing failure.
					</small>
				</article>
				<article>
					<span className={`${styles.statusBadge} ${styles.statusPlanned}`}>
						Implemented locally · not deployed
					</span>
					<h3>Full native gauge model</h3>
					<p>
						The local rollout plan targets 100% of fees from active native
						gauges to voter reward vaults and returns inactive or ungauged pools
						to 100% LP fees.
					</p>
					<small>
						Do not treat this planned source policy as current devnet behavior.
					</small>
				</article>
			</div>
			<div className={styles.creditNotice}>
				<span className={styles.dataLabel}>Bootstrap credit status</span>
				<p>
					The app now contains a separate fee-linked LP bootstrap ledger for
					admin-selected pools. Its keeper estimates provisional veSOLV3 credit
					from observed protocol fees and in-range liquidity. The configured
					pool fee share is readable on-chain; credit depends on the keeper,
					complete price evidence, and review. This is separate from Genesis
					quest XP and is not an issued token balance.
				</p>
			</div>
		</section>

		<section
			className={styles.section}
			id="verify"
			aria-labelledby="verify-title"
		>
			<div className={styles.sectionHeader}>
				<div>
					<div className={styles.eyebrow}>Verify · Technical reference</div>
					<h2 className={styles.sectionTitle} id="verify-title">
						Check the protocol details.
					</h2>
				</div>
				<p className={styles.sectionIntro}>
					Use the current parameters and canonical addresses below to verify the
					devnet system before interacting.
				</p>
			</div>
			<details className={styles.disclosurePanel}>
				<summary>Technical disclosures</summary>
				<p>
					Some protocol operations and the paid-exit conversion rate currently
					rely on configured authorities. Review these details before
					interacting.
				</p>
				<ul>
					<li>The emission schedule determines the weekly SOLV3 amount.</li>
					<li>
						Epoch settlement and gauge eligibility currently use configured
						authorities.
					</li>
					<li>The current devnet programs remain upgradeable.</li>
					<li>
						LedgerOps assessed the ve(3,3) governance programs (SOLVE token,
						core ve(3,3) logic and veSOLVE) in 2026, and all findings are
						closed.{" "}
						<a href={AUDIT_URL} target="_blank" rel="noopener noreferrer">
							Read the audit report
						</a>
						. It does not cover the swap program, which is an Orca Whirlpools
						fork. See{" "}
						<Link href="/risk">Risk and admin roles</Link> for who can change
						what.
					</li>
					<li>
						The SOLV3/SOL conversion rate used for paid exits is published by a
						configured authority rather than a permissionless oracle.
					</li>
				</ul>
			</details>

			<div className={styles.referenceGrid}>
				<div>
					<div className={styles.subsectionHeading}>
						<div className={styles.eyebrow}>Technical reference</div>
						<h3>Exact parameters</h3>
					</div>
					<dl className={styles.parameterList}>
						{parameters.map(([label, value]) => (
							<div key={label}>
								<dt>{label}</dt>
								<dd>{value}</dd>
							</div>
						))}
					</dl>
				</div>
				<div>
					<div className={styles.subsectionHeading}>
						<div className={styles.eyebrow}>Canonical devnet identities</div>
						<h3>Verify the contracts</h3>
					</div>
					<p className={styles.referenceIntro}>
						The website is an interface. Deployed addresses are the
						authoritative identities of the current public devnet cycle.
					</p>
					<div className={styles.addressBlock}>
						<div className={styles.address}>
							<span>veSOLV3 program</span>
							<AddressValue
								address={DEVNET_VE_PROGRAM_ADDRESS}
								label="veSOLV3 program"
							/>
						</div>
						<div className={styles.address}>
							<span>DEX program</span>
							<AddressValue
								address={DEVNET_DEX_PROGRAM_ADDRESS}
								label="DEX program"
							/>
						</div>
						<div className={styles.address}>
							<span>SOLV3 mint</span>
							<AddressValue address={SOLVE.address} label="SOLV3 mint" />
						</div>
					</div>
				</div>
			</div>
		</section>
	</article>
);
