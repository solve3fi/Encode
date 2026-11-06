"use client";

import Link from "next/link";
import { AUDIT_URL } from "@/configs/audit";
import classes from "./Footer.module.css";

export type FooterVariant = "marketing" | "app";

const links = [
	["Charter", "/charter"],
	["Quests", "/quests"],
	["Brand kit", "/brand"],
	["Privacy", "/privacy"],
	["Legal", "/legal"],
	["Terms", "/term"],
] as const;

const socials = [
	["X", "https://x.com/solve3fi"],
	["Discord", "https://discord.gg/ZDyXeyjGc7"],
	["GitHub", "https://github.com/solve3fi"],
] as const;

export const Footer: React.FC<{
	variant?: FooterVariant;
	/** Home page extras: contact address and the launch-partners link. */
	extras?: boolean;
}> = ({ variant = "app", extras = false }) => (
	<footer className={classes.root}>
		<div
			className={`${classes.inner} ${variant === "marketing" ? classes.marketing : ""}`}
		>
			<div className={classes.brand}>
				<span>© {new Date().getFullYear()} Solve3</span>
				<a
					href={AUDIT_URL}
					target="_blank"
					rel="noopener noreferrer"
					className={classes.badge}
					aria-label="Audited by LedgerOps"
					title="LedgerOps audit of the ve(3,3) governance programs. The swap program is not covered."
				>
					<svg
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="#58D7FF"
						strokeWidth="1.9"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z" />
						<path d="M8.5 12l2.5 2.5 4.5-5" />
					</svg>
					<span>Audited by</span>
					{/* biome-ignore lint/performance/noImgElement: static footer badge */}
					<img src="/assets/ledgerops-logo.png" alt="LedgerOps" />
				</a>
			</div>
			<nav className={classes.links} aria-label="Footer navigation">
				{links.slice(0, 1).map(([label, href]) => (
					<Link href={href} key={href}>
						{label}
					</Link>
				))}
				<a href={AUDIT_URL} target="_blank" rel="noopener noreferrer">
					Audit
				</a>
				{links.slice(1).map(([label, href]) => (
					<Link href={href} key={href}>
						{label}
					</Link>
				))}
				{extras && (
					<>
						<a href="mailto:admin@solve3.fi">admin@solve3.fi</a>
						<Link href="/partners">Launch partners</Link>
					</>
				)}
				{socials.map(([label, href]) => (
					<a
						href={href}
						key={href}
						target="_blank"
						rel="noopener noreferrer"
					>
						{label}
					</a>
				))}
			</nav>
		</div>
	</footer>
);
