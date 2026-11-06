"use client";

import { useLingui } from "@lingui/react";
import Link from "next/link";
import { RewardProvider } from "@/stores/reward/RewardProvider";
import { VoteProvider } from "@/stores/vote/VoteProvider";
import { EpochJourney } from "../ProtocolHome/EpochOverview";
import classes from "./Vote.module.css";
import { VoteAutoVoteLink } from "./VoteAutoVoteLink";
import { VoteCastProvider } from "./VoteCast";
import { VoteFilter } from "./VoteFilter";
import { VoteLists } from "./VoteLists";
import { VoteMethod } from "./VoteMethod";
import { VoteMyLists } from "./VoteMyLists";
import { VotePosition } from "./VotePosition";

export const Vote: React.FC = () => {
	const { i18n } = useLingui();
	return (
		<VoteProvider>
			<RewardProvider>
				<VoteCastProvider>
					<div className={classes.page}>
						<header className={classes.hero}>
							<div className={classes.heroCopy}>
								<span className={classes.eyebrow}>
									{i18n._("Governance / Weekly epoch")}
								</span>
								<h1 className={classes.title}>
									{i18n._("Vote the")}{" "}
									<span className={classes.grad}>{i18n._("next flow.")}</span>
								</h1>
								<p className={classes.lede}>
									{i18n._(
										"Direct SOLV3 emissions across the gauges that matter most. Your locked position is the signal that moves the next epoch.",
									)}
								</p>
							</div>
							<div className={classes.heroSide}>
								<Link href="/#this-epoch" className={classes.btnPrimary}>
									{i18n._("See this epoch")}
								</Link>
							</div>
						</header>

						<EpochJourney />

						<VotePosition />

						<section id="active-gauges" className={classes.gauges} aria-label={i18n._("Gauges")}>
							<div className={classes.panelHead}>
								<div>
									<span className={classes.eyebrow}>
										{i18n._("Active gauges")}
									</span>
									<h2
										style={{
											margin: "6px 0 0",
											fontSize: 32,
											letterSpacing: "-0.02em",
										}}
									>
										{i18n._("Where should liquidity flow?")}
									</h2>
									<p className={classes.hint}>
										{i18n._(
											"Sort by vote weight and assign power to the pools you want to strengthen.",
										)}
									</p>
								</div>
							</div>

							<div className={classes.toolbar}>
								<VoteMethod />
								<div className={classes.toolbarGrow}>
									<VoteFilter />
								</div>
								<VoteAutoVoteLink />
							</div>

							<VoteMyLists />
							<VoteLists />
						</section>

						<section
							className={classes.rules}
							aria-label={i18n._("Voting rules")}
						>
							<div className={classes.rule}>
								{i18n._("Split up to 100% across active gauges.")}
							</div>
							<div className={classes.rule}>
								{i18n._("Voting closes five minutes before the epoch ends.")}
							</div>
							<div className={classes.rule}>
								{i18n._(
									"Rewards for votes in epoch N are claimable from epoch N+1.",
								)}
							</div>
						</section>
					</div>
				</VoteCastProvider>
			</RewardProvider>
		</VoteProvider>
	);
};
