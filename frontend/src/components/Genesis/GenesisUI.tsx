import type { PropsWithChildren, ReactNode } from "react";
import classes from "./GenesisUI.module.css";

export function GenesisPageHero({
	eyebrow,
	title,
	children,
}: PropsWithChildren<{ eyebrow: string; title: string }>) {
	return (
		<header className={classes.hero}>
			<span className={classes.eyebrow}>{eyebrow}</span>
			<h1 className={classes.title}>{title}</h1>
			<p className={classes.intro}>{children}</p>
		</header>
	);
}

export function GenesisCard({
	label,
	children,
	aside,
}: PropsWithChildren<{ label?: string; aside?: ReactNode }>) {
	return (
		<section className={classes.card}>
			{label || aside ? (
				<div className={classes.cardHeader}>
					{label ? <span className={classes.label}>{label}</span> : <span />}
					{aside}
				</div>
			) : null}
			{children}
		</section>
	);
}

export function GenesisBadge({ children }: PropsWithChildren) {
	return <span className={classes.badge}>{children}</span>;
}

export function GenesisBanner({
	title,
	children,
}: PropsWithChildren<{ title: string }>) {
	return (
		<div className={classes.banner}>
			<span className={classes.eyebrow}>Solve3 Genesis</span>
			<h1>{title}</h1>
			<p>{children}</p>
		</div>
	);
}

export { classes as genesisClasses };
