import Link from "next/link";
import type { PropsWithChildren, ReactNode } from "react";
import classes from "./ClaimShell.module.css";

/** Shared airdrop / presale page frame: heading, claim steps panel, how-claiming-works note. */
export const ClaimShell: React.FC<
	PropsWithChildren<{ title: ReactNode; lede: ReactNode }>
> = ({ title, lede, children }) => (
	<div className={classes.page}>
		<header className={classes.head}>
			<h1>{title}</h1>
			<p>{lede}</p>
		</header>
		{children}
		<section className={classes.note} aria-label="How claiming works">
			<span className={classes.eyebrow}>How claiming works</span>
			<p>
				Claiming transfers your SOLV3 and permanently locks it into a veSOLV3
				position in a single transaction. It is never held liquid. 1 SOLV3
				locked = 1 veSOLV3, and voting power does not decay. See the{" "}
				<Link href="/charter">Charter</Link> for how locks and exits work.
			</p>
		</section>
	</div>
);

export const GradText: React.FC<PropsWithChildren> = ({ children }) => (
	<span className={classes.grad}>{children}</span>
);
