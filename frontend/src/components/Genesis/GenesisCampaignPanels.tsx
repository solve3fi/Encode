import Link from "next/link";
import { GENESIS_PLAN } from "@/configs/genesis";
import styles from "./GenesisCampaignPanels.module.css";
import { GenesisBadge, GenesisCard, genesisClasses } from "./GenesisUI";

/** Campaign UI remains informational until indexed activity is available. */
export function GenesisProgressPanel() {
	return (
		<GenesisCard
			label="Your Genesis progress"
			aside={<GenesisBadge>Verification pending</GenesisBadge>}
		>
			<p className={styles.lead}>
				Your activity will appear here after campaign tracking is active.
			</p>
			<ul className={styles.progressList}>
				<li>
					<span>First qualifying swap</span>
					<span>Pending</span>
				</li>
				<li>
					<span>Trade on different days</span>
					<span>Pending</span>
				</li>
				<li>
					<span>Featured pool liquidity</span>
					<span>Pending</span>
				</li>
			</ul>
			<p className={styles.note}>
				Normal protocol activity will not require a quest opt-in. This panel
				does not yet award XP or SOLV3.
			</p>
			<Link className={styles.link} href="/quests">
				Explore quests →
			</Link>
		</GenesisCard>
	);
}

export function FeaturedGenesisPools() {
	return (
		<section
			aria-labelledby="featured-genesis-pools"
			className={styles.section}
		>
			<div className={styles.heading}>
				<div>
					<p className={genesisClasses.label}>Genesis Boost / proposed</p>
					<h2 id="featured-genesis-pools">Featured liquidity pools</h2>
				</div>
				<Link className={styles.link} href="/genesis">
					How Genesis works →
				</Link>
			</div>
			<div className={styles.poolGrid}>
				{GENESIS_PLAN.featuredPools.map((pool) => (
					<GenesisCard
						key={pool.id}
						label="Proposed featured pool"
						aside={<GenesisBadge>Pending activation</GenesisBadge>}
					>
						<h3 className={styles.poolName}>{pool.label}</h3>
						<p className={styles.poolDetail}>
							{pool.id === "sol-usdc"
								? "Pool address and eligibility pending verification."
								: "Partner and pool identity to be confirmed."}
						</p>
						<div className={styles.metric}>
							<span>Planned Genesis Boost</span>
							<strong>{pool.weeklySolv3.toLocaleString()} SOLV3 / week</strong>
						</div>
						<div className={styles.metric}>
							<span>Trading APR</span>
							<strong>Not available</strong>
						</div>
						<div className={styles.metric}>
							<span>Genesis Bonus APR</span>
							<strong>Not available</strong>
						</div>
					</GenesisCard>
				))}
			</div>
			<p className={styles.disclosure}>
				Genesis Bonus APR will use a $0.30 SOLV3 campaign reference value and
				qualifying pool TVL once verified data is available. SOLV3 is not
				currently tradable; its future market value may differ. The planned
				rates above are not active rewards.
			</p>
		</section>
	);
}
