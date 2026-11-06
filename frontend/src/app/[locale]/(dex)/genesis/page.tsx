import Link from "next/link";
import { redirect } from "next/navigation";
import {
	genesisClasses as classes,
	GenesisBadge,
	GenesisCard,
	GenesisPageHero,
} from "@/components/Genesis/GenesisUI";
import { LaunchQuests } from "@/components/Genesis/LaunchQuests";
import { AppLayout } from "@/components/Layout/AppLayout";
import { GENESIS_PLAN, GENESIS_PUBLIC_ENABLED } from "@/configs/genesis";

export default function GenesisPage() {
	if (process.env.NODE_ENV === "production" && !GENESIS_PUBLIC_ENABLED)
		redirect("/arena");
	return (
		<AppLayout>
			<main className={classes.page}>
				<GenesisPageHero
					eyebrow="Solve3 Genesis"
					title="Liquidity starts here."
				>
					A community-powered launch built around real trading, stronger
					liquidity, and participation across Solana.
				</GenesisPageHero>
				{/* Soft-launch funnel: Pass mint and the first quests (renders only with a quest campaign). */}
				<LaunchQuests />
				<div className={classes.grid}>
					<GenesisCard label="01 / Genesis Boost">
						<h2 className={classes.sectionTitle}>Bring liquidity</h2>
						<div className={classes.body}>
							<p>
								Featured pools are planned to receive future SOLV3-denominated
								campaign incentives. Rates and eligibility will be published
								when Genesis activates.
							</p>
						</div>
					</GenesisCard>
					<GenesisCard label="02 / Trading">
						<h2 className={classes.sectionTitle}>Support real activity</h2>
						<div className={classes.body}>
							<p>
								Deeper liquidity can improve swap execution. Actual trading
								activity generates fees according to each pool’s deployed
								configuration.
							</p>
						</div>
					</GenesisCard>
					<GenesisCard label="03 / Quests">
						<h2 className={classes.sectionTitle}>Build your place</h2>
						<div className={classes.body}>
							<p>
								Genesis quests are designed around sustained use and reviewed
								community contributions. Progress and rewards will require
								verified activity.
							</p>
						</div>
					</GenesisCard>
				</div>
				<div className={classes.twoColumns}>
					<GenesisCard
						label="Campaign plan"
						aside={<GenesisBadge>Proposed</GenesisBadge>}
					>
						<h2 className={classes.sectionTitle}>A measured start</h2>
						<div className={classes.body}>
							<p>
								The Quest Reserve is{" "}
								{GENESIS_PLAN.questReserveSolv3.toLocaleString()} SOLV3. The
								proposed Genesis ceiling is{" "}
								{GENESIS_PLAN.genesisMaximumSolv3.toLocaleString()} SOLV3, with
								an initial commitment of{" "}
								{GENESIS_PLAN.initialCommitmentSolv3.toLocaleString()} SOLV3.
								These are limits and plans, not earned or distributed rewards.
							</p>
						</div>
					</GenesisCard>
					<GenesisCard
						label="Featured pools"
						aside={<GenesisBadge>Pending activation</GenesisBadge>}
					>
						<h2 className={classes.sectionTitle}>Planned Genesis Boost</h2>
						<ul className={classes.list}>
							{GENESIS_PLAN.featuredPools.map((pool) => (
								<li key={pool.id}>
									<span>{pool.label}</span>
									<span>
										{pool.weeklySolv3.toLocaleString()} SOLV3 / week planned
									</span>
								</li>
							))}
						</ul>
					</GenesisCard>
				</div>
				<div className={classes.disclosure}>
					Genesis rewards are provisional and subject to post-campaign review.
					Manipulative, automated, wash trading, and self-referral activity may
					be excluded. Final allocations happen only after review; unused or
					disqualified rewards remain in the Quest Reserve. SOLV3 is not
					currently tradable, and the $
					{GENESIS_PLAN.solv3ReferenceValueUsd.toFixed(2)} campaign reference
					value is not a market price or redemption promise.
				</div>
				<div>
					<Link className={classes.action} href="/liquidity">
						Explore pools
					</Link>
				</div>
			</main>
		</AppLayout>
	);
}
