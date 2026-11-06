"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useState } from "react";
import { PassMintButton } from "@/components/QuestTest/PassMintButton";
import { useQuestSession } from "@/components/QuestTest/QuestSessionProvider";
import { QuestTestPanel } from "@/components/QuestTest/QuestTestPanel";
import { ReferralCard } from "@/components/QuestTest/ReferralCard";
import { ClusterNetwork, useCluster } from "@/providers/ClusterProvider";
import { ModalType } from "@/stores/modal";
import { useModalActions } from "@/stores/modal/ModalProvider";
import classes from "./Pass.module.css";

const TIERS = [
	{ name: "Explorer", sub: "Start here", accent: "#a6a4b8", edge: "linear-gradient(160deg,#6a6a8a,#2a2a44)", glow: "rgba(140,132,255,0.25)" },
	{ name: "Trader", sub: "Verified trading", accent: "#58d7ff", edge: "linear-gradient(160deg,#58d7ff,#1a4a66)", glow: "rgba(88,215,255,0.35)" },
	{ name: "Liquidity Provider", sub: "Sustained liquidity", accent: "#b3adff", edge: "linear-gradient(160deg,#8c84ff,#3a2f9a)", glow: "rgba(140,132,255,0.4)" },
	{ name: "Liquidity Builder", sub: "Deep contribution", accent: "#f5b14c", edge: "linear-gradient(160deg,#f5b14c,#7a4a14)", glow: "rgba(245,177,76,0.4)" },
	{ name: "Founding LP", sub: "Genesis legend", accent: "#ffd98a", edge: "linear-gradient(160deg,#ffd98a,#8c6a1a,#f5b14c)", glow: "rgba(255,217,138,0.45)" },
] as const;

const PROGRESS = ["10%", "30%", "55%", "80%", "100%"];

const HOW = [
	["01", "Mint once", "Connect your wallet and mint a single Pass. It is yours to keep and starts at the Explorer tier."],
	["02", "Earn XP", "Complete Quests for Quest XP. Vote in an epoch and earn 500 Voting XP when it ends, whether you vote with one lock, several, or through Auto-Vote."],
	["03", "Rise through tiers", "Your tier and artwork update as your XP grows, from Explorer to Founding LP."],
] as const;

export const PassView: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
	const { state: questState } = useQuestSession();
	const questXp = (
		questState as {
			xp?: {
				totalXp: number;
				onboarding: { id: string; completed: boolean; xp: number }[];
				// Test-only Voting XP: one per veSOLV3 epoch voted, awarded when the epoch ends.
				voting?: { votingXp: number; xpPerEpoch: number; currentEpoch: number | null; votedThisEpoch: boolean } | null;
			} | null;
		}
	).xp;
	const mintAward = questXp?.onboarding.find((q) => q.id === "mint-pass" && q.completed);
	const voting = questXp?.voting ?? null;
	const { publicKey } = useWallet();
	const { network } = useCluster();
	const { setOpenModal } = useModalActions();
	const [tier, setTier] = useState(0);
	const t = TIERS[tier];
	const networkLabel = network === ClusterNetwork.Mainnet ? "Solana mainnet" : "Solana devnet";

	return (
		<div className={`${classes.page} ${embedded ? classes.embedded : ""}`}>
			<section className={classes.hero}>
				<div className={classes.heroCopy}>
					<span className={classes.eyebrow}>Solve3 Pass</span>
					<h1>
						Your on-chain record. <span className={classes.grad}>Your legend.</span>
					</h1>
					<p>
						One Pass per wallet. It holds your Quest XP and Voting XP, so your tier and history travel with you.
					</p>
					<div className={classes.actions}>
						{publicKey ? (
							<PassMintButton className={classes.primary} />
						) : (
							<button type="button" className={classes.primary} onClick={() => setOpenModal(ModalType.WALLET)}>
								Connect wallet
							</button>
						)}
						<Link href="/quests" className={classes.link}>
							Earn XP with Quests →
						</Link>
					</div>
					{publicKey && (
						<p className={classes.notice} role="status">
							Devnet test Pass. Wallet verification is required; network and account costs are paid by your wallet. Test XP only, no launch rewards.
						</p>
					)}
					{mintAward && (
						<p className={classes.notice} role="status">
							Pass minted: +{mintAward.xp.toLocaleString()} Devnet test XP. Your total is{" "}
							{questXp?.totalXp.toLocaleString()} test XP.
						</p>
					)}
					<div className={classes.heroStats}>
						<div><strong>1</strong><span>Pass per wallet</span></div>
						<div><strong>2</strong><span>XP types</span></div>
						<div><strong>5</strong><span>Evolving tiers</span></div>
					</div>
				</div>

				<div className={classes.stageWrap}>
					<div className={classes.stage}>
						<div className={classes.float}>
							<div className={classes.edge} style={{ background: t.edge, boxShadow: `0 30px 90px ${t.glow}` }}>
								<div className={classes.card}>
									{/* biome-ignore lint/performance/noImgElement: static SVG artwork */}
									<img src={`/assets/pass/tier-${tier + 1}.svg`} alt="" className={classes.art} />
									<div className={classes.holo} />
									<div className={classes.cardTop}>
										<span>Solve3 Pass</span>
										<span>No. ———</span>
									</div>
									<div className={classes.cardMid}>
										<span className={classes.tierNo} style={{ color: t.accent }}>
											Tier {String(tier + 1).padStart(2, "0")} / 05
										</span>
										<strong>{t.name}</strong>
										<div className={classes.bar}>
											<div style={{ width: PROGRESS[tier], background: t.accent }} />
										</div>
									</div>
									<div className={classes.cardXp}>
										<div><span>Quest XP</span><b>{typeof questXp?.totalXp === "number" ? questXp.totalXp.toLocaleString() : "—"}</b></div>
										<div><span>Voting XP</span><b>{voting ? voting.votingXp.toLocaleString() : "—"}</b></div>
									</div>
									<div className={classes.cardFoot}>
										<span>{networkLabel}</span>
										<span>{voting?.votedThisEpoch ? `Voted this epoch ✓ +${voting.xpPerEpoch} XP at the end` : "Genesis"}</span>
									</div>
								</div>
							</div>
						</div>
					</div>
					<fieldset className={classes.chips} style={{border:0,padding:0,minWidth:0}} aria-label="Preview tier">
						{TIERS.map((item, index) => (
							<button key={item.name} type="button" aria-pressed={tier === index} onClick={() => setTier(index)}>
								{item.name}
							</button>
						))}
					</fieldset>
					<span className={classes.caption}>Preview each tier&apos;s card</span>
				</div>
			</section>

			<section aria-label="The collection" className={classes.section}>
				<span className={classes.eyebrow}>The collection</span>
				<h2>One Pass. Five forms.</h2>
				<p className={classes.lede}>
					Your Pass evolves on-chain as your XP grows. Same NFT, new artwork at every tier.
				</p>
				<div className={classes.collection}>
					{TIERS.map((item, index) => (
						<div className={classes.tierCard} key={item.name} style={{ background: item.edge, boxShadow: `0 20px 60px ${item.glow}` }}>
							<div className={classes.tierInner}>
								{/* biome-ignore lint/performance/noImgElement: static SVG artwork */}
								<img src={`/assets/pass/tier-${index + 1}.svg`} alt="" className={classes.art} />
								<span className={classes.tierLabel}>Tier {String(index + 1).padStart(2, "0")}</span>
								<div className={classes.tierName}>
									<strong>{item.name}</strong>
									<span>{item.sub}</span>
								</div>
							</div>
						</div>
					))}
				</div>
			</section>

			<section aria-label="How it works" className={classes.how}>
				{HOW.map(([n, title, body]) => (
					<div key={n} className={classes.howCard}>
						<span className={classes.eyebrow}>{n}</span>
						<h3>{title}</h3>
						<p>{body}</p>
					</div>
				))}
			</section>

			<ReferralCard />
			<QuestTestPanel historyOnly />
			<section aria-label="Your Pass" className={classes.details}>
				<div className={classes.panel}>
					<span className={classes.eyebrow}>XP breakdown</span>
					{[
						["Quest XP", "#58d7ff", "Trading, liquidity, referral and community quests."],
						["Voting XP", "#8c84ff", "Earned by voting on gauges every epoch."],
					].map(([label, color, text]) => (
						<div key={label} className={classes.xp}>
							<div><span>{label}</span><b>—</b></div>
							<div className={classes.bar}><div style={{ width: "0%", background: color }} /></div>
							<small>{text}</small>
						</div>
					))}
				</div>
				<div className={classes.panel}>
					<span className={classes.eyebrow}>Tier path</span>
					<ol className={classes.path}>
						{TIERS.map((item, index) => (
							<li key={item.name}>
								<span className={classes.pathNo}>{String(index + 1).padStart(2, "0")}</span>
								<span>{item.name}</span>
								<small>{item.sub}</small>
							</li>
						))}
					</ol>
				</div>
				<div className={classes.panel}>
					<span className={classes.eyebrow}>Recent activity</span>
					<p className={classes.muted}>
						{publicKey
							? "No activity yet. Complete a quest or vote in the next epoch and it will appear here."
							: "Connect your wallet to see activity recorded on your Pass."}
					</p>
				</div>
			</section>

			<div className={classes.disclosure}>
				XP reflects reviewed activity and does not guarantee rewards, allocations or returns. See the{" "}
				<Link href="/charter">Charter</Link> for how XP and tiers are defined.
			</div>
		</div>
	);
};
