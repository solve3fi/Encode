"use client";

import { useLingui } from "@lingui/react";
import { CreateLock } from "../CreateLock";
import classes from "./Lock.module.css";
import { LockLists } from "./LockLists";
import { FundNudge } from "@/components/Fund/FundNudge";

const STEPS = [
	["01", "Lock SOLV3", "Create a permanent lock and receive veSOLV3 at 1:1."],
	[
		"02",
		"Vote every epoch",
		"Split up to 100% of your voting power across gauges before Wednesday 23:55 UTC.",
	],
	[
		"03",
		"Claim at N+1",
		"Fees and bribes from votes in epoch N are claimable from epoch N+1.",
	],
] as const;

export const Lock: React.FC = () => {
	const { i18n } = useLingui();

	return (
		<div className={classes.page}>
			<header className={classes.head}>
				<h1>{i18n._("Lock")}</h1>
				<p>
					{i18n._(
						"Lock SOLV3 to receive veSOLV3, your voting power. Locks are permanent and voting power never decays.",
					)}
				</p>
			</header>
			<FundNudge when="low" asset="SOL" title="Need SOL to lock?" text="Locking pays a little SOL in fees." />

			<div className={classes.grid}>
				<CreateLock />

				<div className={classes.side}>
					<section className={classes.panel} aria-label={i18n._("How locks work")}>
						<h2 className={classes.eyebrow}>{i18n._("How locks work")}</h2>
						<ol className={classes.steps}>
							{STEPS.map(([n, title, text]) => (
								<li key={n}>
									<span className={classes.num}>{n}</span>
									<div>
										<h3>{i18n._(title)}</h3>
										<p>{i18n._(text)}</p>
									</div>
								</li>
							))}
						</ol>
					</section>

					<section className={classes.panel} aria-label={i18n._("Exit cost")}>
						<h2 className={classes.title}>{i18n._("Permanent lock")}</h2>
						<p className={classes.text}>
							{i18n._(
								"Locked SOLV3 has no expiry and does not decay. The only way out early is an exit that pays an admin-published SOL fee and returns the full principal.",
							)}
						</p>
					</section>
				</div>
			</div>

			<section className={classes.panel} aria-label={i18n._("Your locks")}>
				<div className={classes.panelHead}>
					<h2 className={classes.title}>{i18n._("Your locks")}</h2>
					<a href="#create-lock" className={classes.link}>
						{i18n._("Create new veNFT")}
					</a>
				</div>
				<LockLists />
			</section>
		</div>
	);
};
