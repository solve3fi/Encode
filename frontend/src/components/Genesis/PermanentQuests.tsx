import Link from "next/link";
import { votingQuestProgress } from "../../../scripts/quest/voting-quest-progress.mjs";
import classes from "./Quests.module.css";

export type VotingOverview = {
	votingXp: number;
	xpPerEpoch: number;
	currentEpoch: number | null;
	votedThisEpoch: boolean;
};

/** Permanent read-only quests. Voting uses the existing governance award. */
export function PermanentQuests({ ready, voting }: { ready: boolean; voting?: VotingOverview | null }) {
	const progress = votingQuestProgress({ ready, voting });
	return (
		<div className={classes.permanentQuests}>
			<section className={`${classes.permanentQuest} ${classes.voteQuest}`} aria-labelledby="weekly-vote-title">
				<div className={classes.permanentHeading}>
					<span className={`${classes.glyph} ${classes.voteGlyph}`} aria-hidden="true">✓</span>
					<div className={classes.qtitle}>
						<span className={`${classes.eyebrow} ${classes.voteLabel}`}>Solve3 · Every week</span>
						<h3 id="weekly-vote-title">Vote weekly</h3>
					</div>
					<span className={classes.chip} data-vote-state={progress.state}>{progress.label}</span>
				</div>
				<p>Vote with a wallet linked to your Pass each epoch. Auto-votes count too.</p>
				<div className={classes.permanentFooter}>
					<div className={classes.permanentReward} aria-live="polite">
						<strong>{progress.xp === null ? "Voting XP" : `+${progress.xp.toLocaleString()} Voting XP`}</strong>
						<span className={classes.progNote}>Awarded after the epoch ends. Resets every epoch.</span>
					</div>
					<Link href="/arena" className={`${classes.btn} ${classes.permanentAction}`}>{progress.state === "done" ? "View your vote" : "Go to Vote"}</Link>
				</div>
			</section>

			<section className={`${classes.permanentQuest} ${classes.partnerQuests}`} aria-labelledby="partner-quests-title">
				<div className={classes.permanentHeading}>
					<span className={`${classes.glyph} ${classes.partnerGlyph}`} aria-hidden="true">✦</span>
					<div className={classes.qtitle}>
						<span className={`${classes.eyebrow} ${classes.partnerLabel}`}>Solve3 partners</span>
						<h3 id="partner-quests-title">Partner Quests</h3>
					</div>
				</div>
				<p className={classes.partnerEmpty}>No quest at this time</p>
			</section>
		</div>
	);
}
